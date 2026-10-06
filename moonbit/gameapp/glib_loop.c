// glib_loop.c — MoonBit async ExternalEventLoop 的 GLib 默认主上下文单步泵。
// yue(GTK 宿主)的消息源全挂默认 GMainContext(nativeui 引用
// g_main_context_default/g_main_context_iteration 为证), 单步迭代即等价
// nu::MessageLoop::Run() 的一轮, 但带外部超时与跨线程唤醒 —— 正好是
// @external_loop_integration 的 poll(timeout) 契约。
//
// 关键坑(glib 2.80 gmain.c 逐句核对 + 本机 GTK 窗口实测):
//   ① prepare 返回"已有就绪源"时【不能】跳过 query/poll/check —— 待派发
//      队列 pending_dispatches 只在 check() 里填充(gmain.c:4096
//      g_ptr_array_add 在 check_unlocked 内); 跳过 check 的 dispatch 是
//      空转, G_SOURCE_READY 永不消费 → 200ns/圈无限自旋(实测 60M 圈/5s,
//      定时器一个不响)。glib 自家的 iterate_unlocked 也总是跑满
//      prepare→query→poll→check→dispatch 五步。
//   ② query 给的 wait 是内部源最近到期时间(有就绪源时=0, 无源时=-1),
//      按外部上限 clamp 后交给 g_poll —— 超时契约(async 定时器精度)与
//      非阻塞语义(Some(0))都由这一处保证。
//   ③ 唤醒: g_main_context_wakeup 写上下文内部 wakeup 管道(纯 C, 线程
//      安全), 阻塞中的 g_poll 立即返回 —— async waiter 线程专用。
// 头文件不依赖 glib.h: 类型自声明(gboolean=int/gushort=u16), 不透明
// GMainContext 用 void*, 符号链接期由系统 glib-2.0 提供(libyue 同源)。
typedef int gboolean;
typedef int gint;
typedef unsigned int guint;
typedef unsigned short gushort;
typedef void *GMainContextPtr;
typedef struct {
  gint fd;
  gushort events;
  gushort revents;
} GPollFD;

extern GMainContextPtr g_main_context_default(void);
extern gboolean g_main_context_acquire(GMainContextPtr);
extern void g_main_context_release(GMainContextPtr);
extern gboolean g_main_context_prepare(GMainContextPtr, gint *);
extern gint g_main_context_query(GMainContextPtr, gint, gint *, GPollFD *, gint);
extern gint g_poll(GPollFD *, guint, gint);
extern gboolean g_main_context_check(GMainContextPtr, gint, GPollFD *, gint);
extern void g_main_context_dispatch(GMainContextPtr);
extern void g_main_context_wakeup(GMainContextPtr);

/* 带超时的单步迭代(默认 GMainContext), 序列=glib iterate_unlocked 同构:
 * prepare → query → poll → check → dispatch(五步总是跑满, 见头注①)。
 * timeout_ms < 0 = 无限等; 0 = 非阻塞; >0 = 至多等这么多毫秒。
 * 返回 1 = 本轮分发了事件, 0 = 空转返回, -1 = acquire 失败(他线程持锁)。 */
int sf_glib_poll(int timeout_ms) {
  gint max_priority = 0;
  GMainContextPtr ctx = g_main_context_default();
  if (!g_main_context_acquire(ctx)) return -1;
  /* 返回值按 glib 自家用法丢弃(check 才是就绪与否的最终裁决) */
  g_main_context_prepare(ctx, &max_priority);
  gint wait = timeout_ms;
  GPollFD fds[128];
  gint n = g_main_context_query(ctx, max_priority, &wait, fds, 128);
  if (n > 128) n = 128; /* GDK/X+at-spi+dbus+定时器源远少于 128; 截断只影响唤醒精度 */
  if (timeout_ms >= 0 && (wait < 0 || wait > timeout_ms)) wait = timeout_ms;
  if (n > 0 || wait != 0) g_poll(fds, (guint)n, wait);
  gboolean some_ready = g_main_context_check(ctx, max_priority, fds, n);
  if (some_ready) g_main_context_dispatch(ctx);
  g_main_context_release(ctx);
  return some_ready ? 1 : 0;
}

/* 跨线程唤醒(async waiter 专用线程调用: 唤醒阻塞中的 g_poll;
 * g_main_context_wakeup 纯 C 且线程安全, 符合 wakeup 回调契约) */
void sf_glib_wakeup(void) {
  g_main_context_wakeup(g_main_context_default());
}
