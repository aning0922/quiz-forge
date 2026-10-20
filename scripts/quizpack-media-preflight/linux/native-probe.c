#define _GNU_SOURCE
#include <errno.h>
#include <dirent.h>
#include <netinet/in.h>
#include <fcntl.h>
#include <linux/sched.h>
#include <linux/mount.h>
#include <sys/vfs.h>
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
static int host_control(const char *root) {
  char path[2300],target[2300];const char *areas[]={"runtime","admin","PGDATA","uploads"};
  for(int i=0;i<4;i++) {
    snprintf(path,sizeof(path),"%s/%s/sentinel",root,areas[i]);snprintf(target,sizeof(target),"%s/%s/control-own",root,areas[i]);
    int fd=open(path,O_RDONLY);check(fd>=0);if(fd>=0){char b;check(read(fd,&b,1)==1);close(fd);}
    fd=open(path,O_WRONLY);check(fd>=0);if(fd>=0)close(fd);
    fd=open(target,O_WRONLY|O_CREAT|O_EXCL,0600);check(fd>=0);if(fd>=0)close(fd);check(unlink(target)==0);
    check(link(path,target)==0);check(unlink(target)==0);check(rename(path,target)==0);check(rename(target,path)==0);
  }
  int listener=socket(AF_INET,SOCK_STREAM,0);check(listener>=0);
  if(listener>=0){struct sockaddr_in addr={.sin_family=AF_INET,.sin_addr.s_addr=htonl(INADDR_LOOPBACK),.sin_port=0};check(bind(listener,(struct sockaddr *)&addr,sizeof(addr))==0);check(listen(listener,1)==0);socklen_t len=sizeof(addr);check(getsockname(listener,(struct sockaddr *)&addr,&len)==0);int client=socket(AF_INET,SOCK_STREAM,0);check(client>=0);if(client>=0){check(connect(client,(struct sockaddr *)&addr,sizeof(addr))==0);close(client);}close(listener);}
  int pair[2];int rc=socketpair(AF_UNIX,SOCK_STREAM,0,pair);check(rc==0);if(rc==0){close(pair[0]);close(pair[1]);}
  int queue=msgget(IPC_PRIVATE,0600);check(queue>=0);if(queue>=0)check(msgctl(queue,IPC_RMID,NULL)==0);
  int segment=shmget(IPC_PRIVATE,4096,0600);check(segment>=0);if(segment>=0)check(shmctl(segment,IPC_RMID,NULL)==0);
  pid_t pid=fork();if(pid==0)_exit(0);check(pid>0);if(pid>0)check(waitpid(pid,NULL,0)==pid);
  int ran=0;pthread_t t;rc=pthread_create(&t,NULL,thread,&ran);check(rc==0);if(rc==0)pthread_join(t,NULL);check(ran==1);
  printf("{\"ok\":%s,\"checks\":%d,\"failures\":%d}",failures?"false":"true",checks,failures);return failures?1:0;
}
int main(int argc, char **argv) {
  if(argc==3 && strcmp(argv[2],"control")==0 && strlen(argv[1])<=2048 && argv[1][0]=='/')return host_control(argv[1]);
  if(argc!=2 || strlen(argv[1])>2048 || argv[1][0]!='/') return 9;
  check(getpid()==1 && getppid()==0);check(getuid()==10001 && geteuid()==10001 && getgid()==10001 && getegid()==10001);
  char status[8192];int statusfd=open("/proc/self/status",O_RDONLY);check(statusfd>=0);if(statusfd>=0){ssize_t n=read(statusfd,status,sizeof(status)-1);check(n>0 && n<(ssize_t)sizeof(status)-1);if(n>0){status[n]=0;check(strstr(status,"NoNewPrivs:\t1")!=NULL);check(strstr(status,"Seccomp:\t2")!=NULL);check(strstr(status,"CapEff:\t0000000000000000")!=NULL);}close(statusfd);}
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
  struct statfs fs;int procfd=open("/proc",O_RDONLY|O_DIRECTORY);check(procfd>=0);if(procfd>=0){check(fstatfs(procfd,&fs)==0 && fs.f_type==0x9fa0);close(procfd);}
  check(syscall(SYS_mount,NULL,NULL,NULL,0,NULL)<0 && errno==EPERM);
  check(syscall(SYS_umount2,"/proc",0)<0 && errno==EPERM);
  check(syscall(SYS_unshare,CLONE_NEWNS)<0 && errno==EPERM);
  check(syscall(SYS_setns,-1,CLONE_NEWNS)<0 && errno==EPERM);
  check(syscall(SYS_fsopen,"proc",FSOPEN_CLOEXEC)<0 && errno==EPERM);
  check(syscall(SYS_open_tree,AT_FDCWD,"/proc",OPEN_TREE_CLONE)<0 && errno==EPERM);
  check(syscall(SYS_move_mount,-1,"",-1,"",0)<0 && errno==EPERM);
  int fd=open("/worker/media-worker.mjs",O_WRONLY); check(denied(fd)); if(fd>=0) close(fd);
  fd=open("/worker/new",O_WRONLY|O_CREAT,0600); check(denied(fd)); if(fd>=0) close(fd);
  fd=open("/var/run/docker.sock",O_RDONLY); check(denied(fd)); if(fd>=0) close(fd);
  for(int i=3;i<4096;i++) check(fcntl(i,F_GETFD)<0 && errno==EBADF);
  DIR *fds=opendir("/proc/self/fd");check(fds!=NULL);
  if(fds){int own=dirfd(fds);struct dirent *entry;int entries=0;while((entry=readdir(fds))){if(++entries>1024){check(0);break;}char *end=NULL;long n=strtol(entry->d_name,&end,10);if(*entry->d_name && !*end && n>=3 && n!=own)check(0);}closedir(fds);}
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
