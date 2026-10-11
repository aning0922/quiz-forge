/* Fixed parent-side identity helper; offline setup compiles it before requests. */
#define _DARWIN_C_SOURCE
#include "identity-query.h"
int main(int argc, char **argv) { return qf_media_identity(argc, argv); }
