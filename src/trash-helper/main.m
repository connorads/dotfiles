#import <Cocoa/Cocoa.h>
#import <Carbon/Carbon.h>

static int report(int status, const char *message) {
    printf("%d\n%s\n", status, message);
    return status;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2 || (strcmp(argv[1], "check") != 0 &&
                          strcmp(argv[1], "authorise") != 0 &&
                          strcmp(argv[1], "empty") != 0)) {
            return report(64, "Usage: empty-trash check|authorise|empty");
        }
        if (geteuid() == 0) {
            return report(1, "Run as your desktop user, without sudo.");
        }
        NSAppleEventDescriptor *target =
            [NSAppleEventDescriptor descriptorWithBundleIdentifier:@"com.apple.finder"];
        OSStatus permission = AEDeterminePermissionToAutomateTarget(
            target.aeDesc, 'fndr', 'empt', strcmp(argv[1], "authorise") == 0);
        if (permission != noErr) {
            printf("1\nFinder permission unavailable (OSStatus %d). "
                   "Run empty-trash authorise from your desktop session.\n", (int)permission);
            return 1;
        }
        if (strcmp(argv[1], "empty") != 0) {
            return report(0, "Finder Trash permission available. Nothing deleted.");
        }
        NSAppleEventDescriptor *event = [NSAppleEventDescriptor
            appleEventWithEventClass:'fndr'
            eventID:'empt'
            targetDescriptor:target
            returnID:kAutoGenerateReturnID
            transactionID:kAnyTransactionID];
        AppleEvent reply = {typeNull, NULL};
        OSStatus status = AESendMessage(event.aeDesc, &reply,
                                       kAEWaitReply | kAENeverInteract, 60 * 60);
        if (status == noErr) {
            SInt32 finderError = noErr;
            DescType actualType;
            Size actualSize;
            OSStatus parameter = AEGetParamPtr(&reply, keyErrorNumber, typeSInt32,
                &actualType, &finderError, sizeof(finderError), &actualSize);
            if (parameter == noErr) status = finderError;
            else if (parameter != errAEDescNotFound) status = parameter;
        }
        AEDisposeDesc(&reply);
        if (status != noErr) {
            printf("1\nFinder could not confirm Trash emptying (OSStatus %d). "
                   "Inspect Trash in Finder before retrying.\n", (int)status);
            return 1;
        }
        return report(0, "Finder completed the empty Trash request.");
    }
}
