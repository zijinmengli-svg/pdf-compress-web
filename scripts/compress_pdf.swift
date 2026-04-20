import Foundation
import PDFKit
import Quartz

if CommandLine.arguments.count != 5 {
    fputs("Usage: compress_pdf.swift <input.pdf> <output.pdf> <scaleFactor> <jpegQuality>\n", stderr)
    exit(64)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let scaleFactor = max(0.1, min(1.0, Double(CommandLine.arguments[3]) ?? 1.0))
let jpegQuality = max(0.1, min(1.0, Double(CommandLine.arguments[4]) ?? 0.92))

guard let document = PDFDocument(url: inputURL) else {
    fputs("Failed to open input PDF\n", stderr)
    exit(1)
}

let filterProps: [String: Any] = [
    "Name": "Codex Adaptive Compression Filter",
    "Domains": [
        "Applications": true,
        "Printing": true
    ],
    "FilterType": 1,
    "FilterData": [
        "ColorSettings": [
            "ImageSettings": [
                "ImageCompression": "ImageJPEGCompress",
                "Compression Quality": jpegQuality,
                "ImageScaleSettings": [
                    "ImageScaleFactor": scaleFactor,
                    "ImageScaleInterpolate": true,
                    "ImageSizeMax": 4096,
                    "ImageSizeMin": 128
                ]
            ]
        ]
    ]
]

guard let filter = QuartzFilter(properties: filterProps) else {
    fputs("Failed to create Quartz filter\n", stderr)
    exit(1)
}

let options = NSDictionary(object: filter, forKey: "QuartzFilter" as NSString)
let ok = document.write(to: outputURL, withOptions: options as! [PDFDocumentWriteOption: Any])
if !ok {
    fputs("Failed to write compressed PDF\n", stderr)
    exit(1)
}
