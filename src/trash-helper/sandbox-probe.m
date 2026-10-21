#import <Foundation/Foundation.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <errno.h>
int main(int argc, const char *argv[]) {
 @autoreleasepool {
  if (argc != 2) return 64;
  FILE *file = fopen(argv[1], "r");
  int readDenied = file == NULL && (errno == EPERM || errno == EACCES);
  if (file) fclose(file);
  int sock = socket(AF_INET, SOCK_STREAM, 0);
  struct sockaddr_in addr = {.sin_len=sizeof(addr), .sin_family=AF_INET,
      .sin_port=htons(9), .sin_addr={htonl(INADDR_LOOPBACK)}};
  int result = connect(sock, (struct sockaddr *)&addr, sizeof(addr));
  int networkDenied = result == -1 && (errno == EPERM || errno == EACCES);
  close(sock);
  printf("read-outside-container-denied=%d network-denied=%d\n", readDenied, networkDenied);
  return readDenied && networkDenied ? 0 : 1;
 }
}
