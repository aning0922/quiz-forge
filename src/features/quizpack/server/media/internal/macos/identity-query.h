/* Shared production identity query; no probe command surface. */
#ifndef QF_MEDIA_IDENTITY_QUERY_H
#define QF_MEDIA_IDENTITY_QUERY_H
#include <errno.h>
#include <libproc.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <unistd.h>
static long qf_media_pid_arg(const char *s) { char *end=NULL;long p=strtol(s,&end,10);return end && !*end && p>0 && p<=2147483647L ? p : -1; }
/* Only ESRCH proves absence; denied/short/invalid queries remain unavailable. */
static int qf_media_query_bsd(pid_t pid, int flavor, struct proc_bsdinfo *b) {
  errno = 0; int n = proc_pidinfo(pid,flavor,0,b,sizeof *b);
  if (n == (int)sizeof *b) return 1;
  if (n == 0 && errno == ESRCH) { errno=0; if(kill(pid,0)<0 && errno==ESRCH)return 0; }
  return -1;
}
static int qf_media_identity(int argc, char **argv) {
  if (argc != 5 || strcmp(argv[1], "identity")) return 64;
    long pid=qf_media_pid_arg(argv[2]), owner=qf_media_pid_arg(argv[3]);if(pid<0 || owner<0)return 64;
    struct proc_bsdinfo b;int q=qf_media_query_bsd((pid_t)pid,PROC_PIDTBSDINFO,&b);
    if(q<0)return 70;
    if(q==0) {fputs("{\"schema\":\"mac-identity.v1\",\"present\":false}",stdout);return 0;}
    char path[PROC_PIDPATHINFO_MAXSIZE];int len=proc_pidpath((int)pid,path,sizeof path);
    const char *exec=len<=0?"unknown":!strcmp(path,argv[4])?"worker":!strcmp(path,"/usr/bin/sandbox-exec")?"sandbox":"other";
    struct rusage_info_v4 usage={0};int usage_ok=proc_pid_rusage((int)pid,RUSAGE_INFO_V4,(rusage_info_t *)&usage)==0;
    printf("{\"schema\":\"mac-identity.v1\",\"present\":true,\"owned\":%s,\"startSec\":%llu,\"startUsec\":%llu,\"executable\":\"%s\",\"residentBytes\":%llu,\"peakFootprintBytes\":%llu}",b.pbi_ppid==(unsigned int)owner?"true":"false",b.pbi_start_tvsec,b.pbi_start_tvusec,exec,usage_ok?usage.ri_resident_size:0,usage_ok?usage.ri_lifetime_max_phys_footprint:0);
  return 0;
}
#endif
