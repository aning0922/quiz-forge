/* Closed synthetic harness only, never a package-selected executable/argv.
 * Compile: cc -std=c11 -Wall -Wextra -Werror -pthread SOURCE -o PRIVATE_OUTPUT
 * Denial means EPERM/EACCES, never ENOENT/ECONNREFUSED. No errno/path/data output. */
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
#include <unistd.h>
extern char **environ;
static int denied(int r) { return r == -1 && (errno == EPERM || errno == EACCES); }
static int open_denied(const char *p, int flags) { int r = open(p, flags, 0600); int d = denied(r); if (r >= 0) close(r); return d; }
static void *thread_run(void *arg) { return arg; }
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
    int s = socket(AF_INET, SOCK_STREAM, 0); if (s < 0) return 70;
    struct sockaddr_in a = {0}; a.sin_family = AF_INET; a.sin_port = htons((unsigned short)port); a.sin_addr.s_addr = htonl(0x7f000001UL);
    int cd = denied(connect(s, (struct sockaddr *)&a, sizeof a)); close(s);
    s = socket(AF_INET, SOCK_STREAM, 0); if (s < 0) return 70;
    a.sin_port = 0; int bd = denied(bind(s, (struct sockaddr *)&a, sizeof a)); close(s);
    s = socket(AF_INET, SOCK_STREAM, 0); if (s < 0) return 70;
    int ld = denied(listen(s, 1)); close(s);
    s = socket(AF_UNIX, SOCK_STREAM, 0); if (s < 0) return 70;
    struct sockaddr_un u = {0}; u.sun_family = AF_UNIX;
    if (strlen(argv[3]) >= sizeof u.sun_path) return 64;
    memcpy(u.sun_path, argv[3], strlen(argv[3]) + 1);
    int ud = denied(connect(s, (struct sockaddr *)&u, sizeof u)); close(s);
    printf("{\"schema\":\"posix-probe.v1\",\"mode\":\"network\",\"connectDenied\":%s,\"bindDenied\":%s,\"listenDenied\":%s,\"unixDenied\":%s}",cd?"true":"false",bd?"true":"false",ld?"true":"false",ud?"true":"false");
  } else if (!strcmp(argv[1], "fd") && argc == 2) {
    int clean = 1;
    for (int i = 3; i < 256; i++) { struct stat st; if (fstat(i, &st) == 0 && (S_ISREG(st.st_mode) || S_ISSOCK(st.st_mode))) clean = 0; }
    printf("{\"schema\":\"posix-probe.v1\",\"mode\":\"fd\",\"noInheritedFileOrSocket\":%s}", clean?"true":"false");
  } else return 64;
  return fflush(stdout) == 0 ? 0 : 70;
}
