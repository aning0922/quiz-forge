/* Closed synthetic harness only, never a package-selected executable/argv.
 * Compile: cc -std=c11 -Wall -Wextra -Werror -pthread SOURCE -o PRIVATE_OUTPUT
 * Denial means EPERM/EACCES, never ENOENT/ECONNREFUSED. No errno/path/data output. */
#ifdef __APPLE__
#define _DARWIN_C_SOURCE
#endif
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <netinet/in.h>
#include <dirent.h>
#include <limits.h>
#ifdef __APPLE__
#include <libproc.h>
#endif
#include <unistd.h>
extern char **environ;
static int denied(int r) { return r == -1 && (errno == EPERM || errno == EACCES); }
static int open_denied(const char *p, int flags) { int r = open(p, flags, 0600); int d = denied(r); if (r >= 0) close(r); return d; }
static void *thread_run(void *arg) { return arg; }
static const char *operation(int r) { return r == 0 ? "allowed" : denied(r) ? "operation-denied" : "failed"; }
static int scan_fds(int *clean) {
  *clean = 1;
#ifdef __APPLE__
  const int cap = 65536;
  int need = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, NULL, 0);
  if (need <= 0 || need >= cap * (int)sizeof(struct proc_fdinfo)) return 0;
  struct proc_fdinfo *list = calloc((size_t)cap, sizeof(*list)); if (!list) return 0;
  int n = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, list, cap * (int)sizeof(*list));
  if (n <= 0 || n >= cap * (int)sizeof(*list) || n % (int)sizeof(*list)) { free(list); return 0; }
  for (int i = 0; i < n / (int)sizeof(*list); i++) {
    if (list[i].proc_fd < 3) continue;
    struct stat st; if (fstat(list[i].proc_fd, &st) < 0) { free(list); return 0; }
    /* Any extra descriptor is conservatively treated as a possible IPC/file capability. */
    *clean = 0;
  }
  free(list); return 1;
#else
  DIR *d = opendir("/proc/self/fd"); if (!d) return 0;
  int own = dirfd(d), count = 0, complete = 1;
  for (;;) {
    errno = 0; struct dirent *e = readdir(d); if (!e) { if (errno) complete = 0; break; }
    if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
    char *end = NULL; errno = 0; long fd = strtol(e->d_name, &end, 10);
    if (errno || !end || *end || fd < 0 || fd > INT_MAX || ++count > 65536) { complete = 0; break; }
    if (fd < 3 || fd == own) continue;
    struct stat st; if (fstat((int)fd, &st) < 0) { complete = 0; break; }
    *clean = 0;
  }
  if (closedir(d)) complete = 0;
  return complete;
#endif
}
static int wait_child(pid_t pid) { int status; return waitpid(pid, &status, 0) == pid; }
int main(int argc, char **argv) {
  if (argc < 2) return 64;
  if (!strcmp(argv[1], "files") && argc == 3) {
    char src[4096], create[4096], dest[4096];
    if (snprintf(src, sizeof src, "%s/sentinel", argv[2]) >= (int)sizeof src ||
        snprintf(create, sizeof create, "%s/create", argv[2]) >= (int)sizeof create ||
        snprintf(dest, sizeof dest, "%s/destination", argv[2]) >= (int)sizeof dest) return 64;
    int rd = open_denied(src, O_RDONLY), wr = open_denied(src, O_WRONLY);
    int cr = open_denied(create, O_CREAT | O_EXCL | O_WRONLY);
    int lk = denied(link(src, dest)); int rn = denied(rename(src, dest));
    int ul = denied(unlink(src));
    printf("{\"schema\":\"posix-probe.v1\",\"mode\":\"files\",\"readDenied\":%s,\"writeDenied\":%s,\"createDenied\":%s,\"linkDenied\":%s,\"renameDenied\":%s,\"unlinkDenied\":%s}", rd?"true":"false", wr?"true":"false", cr?"true":"false", lk?"true":"false", rn?"true":"false", ul?"true":"false");
  } else if (!strcmp(argv[1], "process") && argc == 2) {
    pthread_t t; int tc = pthread_create(&t, NULL, thread_run, NULL); int thread_ok = tc == 0 && pthread_join(t, NULL) == 0;
    pid_t p = fork(); int fd = denied((int)p); if (p == 0) _exit(0); if (p > 0 && !wait_child(p)) return 70;
    pid_t sp; char *args[] = {"/usr/bin/true", NULL}; int sc = posix_spawn(&sp, args[0], NULL, NULL, args, environ);
    int sd = sc == EPERM || sc == EACCES; if (!sc && !wait_child(sp)) return 70;
    printf("{\"schema\":\"posix-probe.v1\",\"mode\":\"process\",\"threadAllowed\":%s,\"forkDenied\":%s,\"spawnDenied\":%s}",thread_ok?"true":"false",fd?"true":"false",sd?"true":"false");
  } else if (!strcmp(argv[1], "network") && argc == 4) {
    char *end = NULL; long port = strtol(argv[2], &end, 10); if (!end || *end || port < 1 || port > 65535) return 64;
    struct sockaddr_in a = {0}; a.sin_family = AF_INET; a.sin_port = htons((unsigned short)port); a.sin_addr.s_addr = htonl(0x7f000001UL);
    const char *results[4];
    for (int i = 0; i < 4; i++) {
      int s = socket(i == 3 ? AF_UNIX : AF_INET, SOCK_STREAM, 0);
      if (s < 0) { if (!denied(s)) return 70; results[i] = "socket-denied"; continue; }
      int r;
      if (i == 0) r = connect(s, (struct sockaddr *)&a, sizeof a);
      else if (i == 1) { struct sockaddr_in bind_addr = a; bind_addr.sin_port = 0; r = bind(s, (struct sockaddr *)&bind_addr, sizeof bind_addr); }
      else if (i == 2) {
        struct sockaddr_in bind_addr = a; bind_addr.sin_port = 0;
        int b = bind(s, (struct sockaddr *)&bind_addr, sizeof bind_addr);
        if (b < 0) { results[i] = denied(b) ? "prerequisite-denied" : "failed"; close(s); continue; }
        r = listen(s, 1);
      }
      else {
        struct sockaddr_un u = {0}; u.sun_family = AF_UNIX;
        if (strlen(argv[3]) >= sizeof u.sun_path) { close(s); return 64; }
        memcpy(u.sun_path, argv[3], strlen(argv[3]) + 1);
        r = connect(s, (struct sockaddr *)&u, sizeof u);
      }
      results[i] = operation(r); close(s);
    }
    printf("{\"schema\":\"posix-probe.v1\",\"mode\":\"network\",\"connect\":\"%s\",\"bind\":\"%s\",\"listen\":\"%s\",\"unix\":\"%s\"}", results[0], results[1], results[2], results[3]);
  } else if (!strcmp(argv[1], "fd") && argc == 2) {
    int clean = 0; int complete = scan_fds(&clean);
    printf("{\"schema\":\"posix-probe.v1\",\"mode\":\"fd\",\"scanComplete\":%s,\"noInheritedFileOrSocket\":%s}", complete?"true":"false", complete && clean?"true":"false");
  } else return 64;
  return fflush(stdout) == 0 ? 0 : 70;
}
