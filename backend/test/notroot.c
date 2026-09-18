#define _GNU_SOURCE
#include <dlfcn.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static const uid_t FAKE = 999;

uid_t getuid(void) { return FAKE; }
uid_t geteuid(void) { return FAKE; }
uid_t getgid(void) { return FAKE; }
uid_t getegid(void) { return FAKE; }

static void patch(struct stat *buf) {
  if (buf) {
    buf->st_uid = FAKE;
    buf->st_gid = FAKE;
  }
}

int stat(const char *path, struct stat *buf) {
  int (*real)(const char *, struct stat *) = dlsym(RTLD_NEXT, "stat");
  int r = real(path, buf);
  if (r == 0) patch(buf);
  return r;
}

int lstat(const char *path, struct stat *buf) {
  int (*real)(const char *, struct stat *) = dlsym(RTLD_NEXT, "lstat");
  int r = real(path, buf);
  if (r == 0) patch(buf);
  return r;
}

int fstat(int fd, struct stat *buf) {
  int (*real)(int, struct stat *) = dlsym(RTLD_NEXT, "fstat");
  int r = real(fd, buf);
  if (r == 0) patch(buf);
  return r;
}

int __xstat(int ver, const char *path, struct stat *buf) {
  int (*real)(int, const char *, struct stat *) = dlsym(RTLD_NEXT, "__xstat");
  int r = real(ver, path, buf);
  if (r == 0) patch(buf);
  return r;
}

int __lxstat(int ver, const char *path, struct stat *buf) {
  int (*real)(int, const char *, struct stat *) = dlsym(RTLD_NEXT, "__lxstat");
  int r = real(ver, path, buf);
  if (r == 0) patch(buf);
  return r;
}

int __fxstat(int ver, int fd, struct stat *buf) {
  int (*real)(int, int, struct stat *) = dlsym(RTLD_NEXT, "__fxstat");
  int r = real(ver, fd, buf);
  if (r == 0) patch(buf);
  return r;
}
