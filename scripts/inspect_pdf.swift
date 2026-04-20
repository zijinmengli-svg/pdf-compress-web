import Foundation
import PDFKit

struct Output: Codable {
    let ok: Bool
    let encrypted: Bool
    let pageCount: Int
    let error: String?
}

if CommandLine.arguments.count != 2 {
    fputs("Usage: inspect_pdf.swift <input.pdf>\n", stderr)
    exit(64)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])

guard let document = PDFDocument(url: inputURL) else {
    let output = Output(ok: false, encrypted: false, pageCount: 0, error: "invalid_pdf")
    let data = try! JSONEncoder().encode(output)
    FileHandle.standardOutput.write(data)
    exit(0)
}

let encrypted = document.isLocked
let pageCount = document.pageCount
let output = Output(
    ok: !encrypted && pageCount > 0,
    encrypted: encrypted,
    pageCount: pageCount,
    error: encrypted ? "encrypted_pdf" : (pageCount > 0 ? nil : "invalid_pdf")
)

let data = try! JSONEncoder().encode(output)
FileHandle.standardOutput.write(data)
