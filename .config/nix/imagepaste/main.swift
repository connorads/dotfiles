import AppKit
import Foundation
import UniformTypeIdentifiers

enum ImagePasteError: Error, CustomStringConvertible {
    case usage
    case noImage
    case invalidDestination

    var description: String {
        switch self {
        case .usage:
            return "usage: imagepaste DEST_STEM"
        case .noImage:
            return "no GIF or image in clipboard"
        case .invalidDestination:
            return "destination must not have a filename extension"
        }
    }
}

func isGIF(_ data: Data) -> Bool {
    guard data.count >= 6 else { return false }
    return data.prefix(6) == Data("GIF87a".utf8) || data.prefix(6) == Data("GIF89a".utf8)
}

func write(_ data: Data, stem: String, extension fileExtension: String) throws -> String {
    let path = "\(stem).\(fileExtension)"
    try data.write(to: URL(fileURLWithPath: path), options: .atomic)
    return path
}

func capture(stem: String) throws -> String {
    guard URL(fileURLWithPath: stem).pathExtension.isEmpty else {
        throw ImagePasteError.invalidDestination
    }

    let pasteboard = NSPasteboard.general
    let gifType = NSPasteboard.PasteboardType(UTType.gif.identifier)

    if let data = pasteboard.data(forType: gifType), isGIF(data) {
        return try write(data, stem: stem, extension: "gif")
    }

    let fileOptions: [NSPasteboard.ReadingOptionKey: Any] = [
        .urlReadingFileURLsOnly: true,
    ]
    if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: fileOptions) as? [URL] {
        for url in urls where url.isFileURL {
            if let data = try? Data(contentsOf: url), isGIF(data) {
                return try write(data, stem: stem, extension: "gif")
            }
        }
    }

    if let data = pasteboard.data(forType: .png) {
        return try write(data, stem: stem, extension: "png")
    }

    if let image = NSImage(pasteboard: pasteboard),
       let tiff = image.tiffRepresentation,
       let bitmap = NSBitmapImageRep(data: tiff),
       let png = bitmap.representation(using: .png, properties: [:]) {
        return try write(png, stem: stem, extension: "png")
    }

    throw ImagePasteError.noImage
}

do {
    guard CommandLine.arguments.count == 2 else { throw ImagePasteError.usage }
    print(try capture(stem: CommandLine.arguments[1]))
} catch {
    FileHandle.standardError.write(Data("imagepaste: \(error)\n".utf8))
    exit(1)
}
