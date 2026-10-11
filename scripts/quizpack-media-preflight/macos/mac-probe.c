/* Closed synthetic harness and trusted child-identity inspection only. */
#define _DARWIN_C_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <mach/mach.h>
#include <servers/bootstrap.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>
static const char *denial(int r) { return r >= 0 ? "allowed" : (errno == EPERM || errno == EACCES) ? "denied" : errno == EBADF ? "closed" : "failed"; }
static long pid_arg(const char *s) { char *end=NULL;long p=strtol(s,&end,10);return end && !*end && p>0 && p<=2147483647L ? p : -1; }
int main(int argc,char **argv) {
  if(argc<2)return 64;
  if(!strcmp(argv[1],"identity") && argc==5) {
    long pid=pid_arg(argv[2]), owner=pid_arg(argv[3]);if(pid<0 || owner<0)return 64;
    struct proc_bsdinfo b;int n=proc_pidinfo((int)pid,PROC_PIDTBSDINFO,0,&b,sizeof b);
    if(n!=(int)sizeof b) {fputs("{\"schema\":\"mac-identity.v1\",\"present\":false}",stdout);return 0;}
    char path[PROC_PIDPATHINFO_MAXSIZE];int len=proc_pidpath((int)pid,path,sizeof path);
    const char *exec=len<=0?"unknown":!strcmp(path,argv[4])?"worker":!strcmp(path,"/usr/bin/sandbox-exec")?"sandbox":"other";
    struct rusage_info_v4 usage={0};int usage_ok=proc_pid_rusage((int)pid,RUSAGE_INFO_V4,(rusage_info_t *)&usage)==0;
    printf("{\"schema\":\"mac-identity.v1\",\"present\":true,\"owned\":%s,\"startSec\":%llu,\"startUsec\":%llu,\"executable\":\"%s\",\"residentBytes\":%llu,\"peakFootprintBytes\":%llu}",b.pbi_ppid==(unsigned int)owner?"true":"false",b.pbi_start_tvsec,b.pbi_start_tvusec,exec,usage_ok?usage.ri_resident_size:0,usage_ok?usage.ri_lifetime_max_phys_footprint:0);
  } else if(!strcmp(argv[1],"server") && argc==3) {
    mach_port_t receive=MACH_PORT_NULL; if(mach_port_allocate(mach_task_self(),MACH_PORT_RIGHT_RECEIVE,&receive)!=KERN_SUCCESS)return 70;
    if(mach_port_insert_right(mach_task_self(),receive,receive,MACH_MSG_TYPE_MAKE_SEND)!=KERN_SUCCESS)return 70;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    kern_return_t r=bootstrap_register(bootstrap_port,argv[2],receive);
#pragma clang diagnostic pop
    if(r!=KERN_SUCCESS)return 70;
    signal(SIGUSR1,SIG_IGN);fputs("{\"schema\":\"mac-service.v1\",\"ready\":true}",stdout);fflush(stdout);
    char c;while(read(0,&c,1)<0 && errno==EINTR){};mach_port_mod_refs(mach_task_self(),receive,MACH_PORT_RIGHT_RECEIVE,-1);mach_port_deallocate(mach_task_self(),receive);
  } else if(!strcmp(argv[1],"ipc") && argc==5) {
    mach_port_t port=MACH_PORT_NULL;kern_return_t r=bootstrap_look_up(bootstrap_port,argv[2],&port);
    const char *mach=r==KERN_SUCCESS?"allowed":r==BOOTSTRAP_NOT_PRIVILEGED?"denied":"failed";
    if(port!=MACH_PORT_NULL)mach_port_deallocate(mach_task_self(),port);
    int fd=shm_open(argv[3],O_RDWR,0);const char *shm=denial(fd);if(fd>=0)close(fd);
    long peer=pid_arg(argv[4]);if(peer<0)return 64;int sig=kill((pid_t)peer,SIGUSR1);const char *signal_result=denial(sig);
    printf("{\"schema\":\"mac-probe.v1\",\"mode\":\"ipc\",\"machLookup\":\"%s\",\"sharedMemory\":\"%s\",\"peerSignal\":\"%s\"}",mach,shm,signal_result);
  } else if(!strcmp(argv[1],"shm-create") && argc==3) {
    int fd=shm_open(argv[2],O_RDWR|O_CREAT|O_EXCL,0600);if(fd<0)return 70;
    if(ftruncate(fd,16)<0){close(fd);shm_unlink(argv[2]);return 70;}close(fd);
    fputs("{\"schema\":\"mac-shm.v1\",\"created\":true}",stdout);
  } else if(!strcmp(argv[1],"shm-remove") && argc==3) {
    if(shm_unlink(argv[2])<0)return 70;fputs("{\"schema\":\"mac-shm.v1\",\"removed\":true}",stdout);
  } else if(!strcmp(argv[1],"vfork") && argc==2) {
    #pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    pid_t pid=vfork();int err=errno;
#pragma clang diagnostic pop
    if(pid==0)_exit(0);
    if(pid>0){int status;if(waitpid(pid,&status,0)!=pid)return 70;}
    printf("{\"schema\":\"mac-probe.v1\",\"mode\":\"vfork\",\"denied\":%s}",pid<0&&(err==EPERM||err==EACCES)?"true":"false");
  } else if(!strcmp(argv[1],"fd-data") && argc==2) {
    char b=0;int rd=(int)pread(3,&b,1,0);const char *read_result=denial(rd);
    int wr=(int)pwrite(3,"x",1,0);const char *write_result=denial(wr);
    printf("{\"schema\":\"mac-probe.v1\",\"mode\":\"fd-data\",\"read\":\"%s\",\"write\":\"%s\"}",read_result,write_result);
  } else if(!strcmp(argv[1],"listen") && argc==2) {
    int s=socket(AF_INET,SOCK_STREAM,0);if(s<0)return 70;
    int r=listen(s,1);const char *result=denial(r);close(s);
    printf("{\"schema\":\"mac-probe.v1\",\"mode\":\"listen\",\"listen\":\"%s\"}",result);
  } else return 64;
  return fflush(stdout)==0?0:70;
}
