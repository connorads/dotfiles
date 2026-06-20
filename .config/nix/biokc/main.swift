// biokc — biometric (Touch ID) keychain helper
//
//   biokc set    <service> <account>   # store secret from stdin
//   biokc get    <service> <account>   # print secret to stdout (Touch ID first)
//   biokc delete <service> <account>
//
// Why this exists: the stock `security` CLI can only gate a keychain item behind
// the keychain *password*, never Touch ID. The proper Secure-Enclave route
// (SecAccessControl .biometryCurrentSet) needs a team-prefixed
// keychain-access-groups entitlement — i.e. a paid Apple Developer cert — and an
// ad-hoc binary claiming one is killed by the kernel (Killed: 9).
//
// So we split the two concerns: biometrics are enforced in-process via
// LocalAuthentication (needs no entitlement), and the secret lives in the legacy
// login keychain where SecItemAdd from this binary auto-pins the item ACL to
// THIS binary's code identity. Net effect: only biokc reads the item silently;
// any other process hits the password prompt; and biokc never returns the secret
// without a fresh Touch ID. On macOS 26 task_for_pid is denied to unprivileged
// same-user code, so the in-process gate can't be skipped by injection.

import Foundation
import Security
import LocalAuthentication

func die(_ msg: String, _ code: Int32 = 1) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(code)
}
func secErr(_ s: OSStatus) -> String { (SecCopyErrorMessageString(s, nil) as String?) ?? "OSStatus \(s)" }

let args = CommandLine.arguments
guard args.count >= 4 else { die("usage: biokc <set|get|delete> <service> <account>") }
let cmd = args[1], service = args[2], account = args[3]

func baseQuery() -> [String: Any] {
    [ kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account ]
}

func requireBiometric(_ reason: String) {
    let ctx = LAContext()
    var e: NSError?
    guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &e) else {
        die("biometrics unavailable: \(e?.localizedDescription ?? "?")", 2)
    }
    let sem = DispatchSemaphore(value: 0); var ok = false; var ae: Error?
    ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { s, err in
        ok = s; ae = err; sem.signal()
    }
    sem.wait()
    if !ok { die("Touch ID failed: \(ae?.localizedDescription ?? "denied")", 3) }
}

switch cmd {
case "set":
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty else { die("no secret on stdin") }
    SecItemDelete(baseQuery() as CFDictionary)
    var add = baseQuery()
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let s = SecItemAdd(add as CFDictionary, nil)
    guard s == errSecSuccess else { die("SecItemAdd failed: \(secErr(s))") }
    print("stored \(service)/\(account)")

case "get":
    requireBiometric("unlock the \(service) secret")
    var q = baseQuery()
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: AnyObject?
    let s = SecItemCopyMatching(q as CFDictionary, &out)
    guard s == errSecSuccess, let data = out as? Data else { die("read failed: \(secErr(s))") }
    FileHandle.standardOutput.write(data)

case "delete":
    let s = SecItemDelete(baseQuery() as CFDictionary)
    guard s == errSecSuccess || s == errSecItemNotFound else { die("delete failed: \(secErr(s))") }
    print("deleted")

default: die("unknown command: \(cmd)")
}
