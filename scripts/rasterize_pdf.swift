import Foundation
import PDFKit
import AppKit
import ImageIO

if CommandLine.arguments.count != 6 {
    fputs("Usage: rasterize_pdf.swift <input.pdf> <output.pdf> <dpi> <jpegQuality> <grayscale:0|1>\n", stderr)
    exit(64)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let dpi = max(6.0, min(200.0, Double(CommandLine.arguments[3]) ?? 72.0))
let jpegQuality = max(0.01, min(1.0, Double(CommandLine.arguments[4]) ?? 0.5))
let grayscale = CommandLine.arguments[5] == "1"
let renderScale = CGFloat(dpi / 72.0)

guard let document = PDFDocument(url: inputURL), document.pageCount > 0 else {
    fputs("Failed to open input PDF\n", stderr)
    exit(1)
}

guard let pdfContext = CGContext(outputURL as CFURL, mediaBox: nil, nil) else {
    fputs("Failed to create output PDF context\n", stderr)
    exit(1)
}

func jpegCGImage(from page: PDFPage, pageRect: CGRect) -> CGImage? {
    let pixelWidth = max(1, Int(ceil(pageRect.width * renderScale)))
    let pixelHeight = max(1, Int(ceil(pageRect.height * renderScale)))
    guard
        let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: pixelWidth,
            pixelsHigh: pixelHeight,
            bitsPerSample: 8,
            samplesPerPixel: grayscale ? 1 : 4,
            hasAlpha: false,
            isPlanar: false,
            colorSpaceName: grayscale ? .deviceWhite : .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: grayscale ? 8 : 32
        ),
        let graphics = NSGraphicsContext(bitmapImageRep: bitmap)
    else {
        return nil
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    let cg = graphics.cgContext
    cg.setFillColor((grayscale ? NSColor.white : NSColor.white).cgColor)
    cg.fill(CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
    cg.saveGState()
    cg.scaleBy(x: renderScale, y: renderScale)
    page.draw(with: .mediaBox, to: cg)
    cg.restoreGState()
    graphics.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()

    guard let jpegData = bitmap.representation(
        using: NSBitmapImageRep.FileType.jpeg,
        properties: [NSBitmapImageRep.PropertyKey.compressionFactor: jpegQuality]
    ) else {
        return nil
    }
    guard
        let source = CGImageSourceCreateWithData(jpegData as CFData, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
        return nil
    }
    return image
}

for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { continue }
    var mediaBox = page.bounds(for: .mediaBox)
    pdfContext.beginPDFPage([kCGPDFContextMediaBox as String: NSData(bytes: &mediaBox, length: MemoryLayout<CGRect>.size)] as CFDictionary)
    if let cgImage = jpegCGImage(from: page, pageRect: mediaBox) {
        pdfContext.draw(cgImage, in: mediaBox)
    }
    pdfContext.endPDFPage()
}

pdfContext.closePDF()
