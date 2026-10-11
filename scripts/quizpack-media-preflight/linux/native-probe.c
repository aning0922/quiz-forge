#define _GNU_SOURCE
#include <errno.h>
#include <dirent.h>
#include <fcntl.h>
#include <linux/sched.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ipc.h>
#include <sys/msg.h>
#include <sys/shm.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static int checks=0, failures=0;
static void check(int ok) { checks++; if(!ok) failures++; }
static int denied(int n) { return n < 0 && (errno==EPERM || errno==EACCES || errno==EROFS || errno==ENOENT); }
static void *thread(void *x) { *(int *)x=1; return NULL; }
int main(int argc, char **argv) {
  if(argc!=2 || strlen(argv[1])>2048 || argv[1][0]!='/') return 9;
  char path[2300], target[2300], alias[2400];
  const char *areas[]={"runtime","admin","PGDATA","uploads"};
  for(int i=0;i<4;i++) {
    snprintf(path,sizeof(path),"%s/%s/sentinel",argv[1],areas[i]);
    snprintf(target,sizeof(target),"%s/%s/new",argv[1],areas[i]);
    int fd=open(path,O_RDONLY); check(denied(fd)); if(fd>=0) close(fd);
    fd=open(path,O_WRONLY); check(denied(fd)); if(fd>=0) close(fd);
    fd=open(target,O_WRONLY|O_CREAT|O_EXCL,0600); check(denied(fd)); if(fd>=0) close(fd);
    check(denied(unlink(path))); check(denied(link(path,target))); check(denied(rename(path,target)));
    snprintf(alias,sizeof(alias),"/proc/1/root%s",path);
    fd=open(alias,O_RDONLY); check(denied(fd)); if(fd>=0) close(fd);
    snprintf(alias,sizeof(alias),"%s/%s/alias",argv[1],areas[i]);
    fd=open(alias,O_RDONLY); check(denied(fd)); if(fd>=0) close(fd);
  }
  int fd=open("/worker/media-worker.mjs",O_WRONLY); check(denied(fd)); if(fd>=0) close(fd);
  fd=open("/worker/new",O_WRONLY|O_CREAT,0600); check(denied(fd)); if(fd>=0) close(fd);
  fd=open("/var/run/docker.sock",O_RDONLY); check(denied(fd)); if(fd>=0) close(fd);
  for(int i=3;i<4096;i++) check(fcntl(i,F_GETFD)<0 && errno==EBADF);
  DIR *fds=opendir("/proc/self/fd");check(fds!=NULL);
  if(fds){int own=dirfd(fds);struct dirent *entry;while((entry=readdir(fds))){char *end=NULL;long n=strtol(entry->d_name,&end,10);if(*entry->d_name && !*end && n>=3 && n!=own)check(0);}closedir(fds);}
  check(syscall(SYS_socket,AF_INET,SOCK_STREAM,0)<0 && errno==EPERM);
  check(syscall(SYS_socket,AF_UNIX,SOCK_STREAM,0)<0 && errno==EPERM);
  check(syscall(SYS_connect,-1,NULL,0)<0 && errno==EPERM);
  check(syscall(SYS_bind,-1,NULL,0)<0 && errno==EPERM);
  check(syscall(SYS_listen,-1,1)<0 && errno==EPERM);
  check(syscall(SYS_socketpair,AF_UNIX,SOCK_STREAM,0,NULL)<0 && errno==EPERM);
  check(syscall(SYS_msgget,IPC_PRIVATE,0600)<0 && errno==EPERM);
  check(syscall(SYS_shmget,IPC_PRIVATE,4096,0600)<0 && errno==EPERM);
  pid_t pid=fork(); if(pid==0) _exit(0); check(pid<0 && errno==EPERM); if(pid>0) waitpid(pid,NULL,0);
  // Direct vfork/clone routes as well as libc fork. No shared-VM child code.
  pid=syscall(SYS_vfork); if(pid==0) _exit(0); check(pid<0 && errno==EPERM); if(pid>0) waitpid(pid,NULL,0);
  pid=syscall(SYS_clone,SIGCHLD,0,0,0,0); if(pid==0) _exit(0); check(pid<0 && errno==EPERM); if(pid>0) waitpid(pid,NULL,0);
  struct clone_args args={.exit_signal=SIGCHLD};
  pid=syscall(SYS_clone3,&args,sizeof(args)); if(pid==0) _exit(0); check(pid<0 && errno==ENOSYS); if(pid>0) waitpid(pid,NULL,0);
  check(syscall(SYS_kill,1,0)<0 && errno==EPERM);
  int ran=0; pthread_t t; int rc=pthread_create(&t,NULL,thread,&ran); check(rc==0); if(rc==0) pthread_join(t,NULL); check(ran==1);
  printf("{\"ok\":%s,\"checks\":%d,\"failures\":%d}",failures?"false":"true",checks,failures);
  return failures?1:0;
}
