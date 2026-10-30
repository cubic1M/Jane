// Turns a folder of numbered PNG frames into an H.264 MP4 with macOS's own AVFoundation, for
// machines without ffmpeg (Playwright's bundled ffmpeg can decode the recording to frames but
// only encodes VP9). Usage: swift frames-to-mp4.swift <frames dir> <out.mp4> <fps>

import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

let args = CommandLine.arguments
guard args.count == 4, let fps = Int32(args[3]) else {
  FileHandle.standardError.write("usage: frames-to-mp4.swift <frames dir> <out.mp4> <fps>\n".data(using: .utf8)!)
  exit(2)
}
let dir = URL(fileURLWithPath: args[1])
let out = URL(fileURLWithPath: args[2])
let frames = try FileManager.default.contentsOfDirectory(atPath: dir.path)
  .filter { $0.hasSuffix(".png") }
  .sorted()
  .map { dir.appendingPathComponent($0) }
guard let first = frames.first else { fatalError("no frames in \(dir.path)") }

func image(_ url: URL) -> CGImage {
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else { fatalError("can't read \(url.path)") }
  return image
}

let size = image(first)
let width = size.width
let height = size.height
try? FileManager.default.removeItem(at: out)
let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
// Sharp text: about 0.2 bits a pixel a frame, at least 6 Mbit/s.
let bitrate = max(6_000_000, Int(Double(width * height) * Double(fps) * 0.2))
let input = AVAssetWriterInput(
  mediaType: .video,
  outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
      AVVideoAverageBitRateKey: bitrate,
      AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      AVVideoMaxKeyFrameIntervalKey: Int(fps) * 2,
    ],
  ])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
  assetWriterInput: input,
  sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
  ])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

for (index, url) in frames.enumerated() {
  autoreleasepool {
    while !input.isReadyForMoreMediaData { usleep(2_000) }
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
    guard let pixels = buffer else { fatalError("no pixel buffer") }
    CVPixelBufferLockBaseAddress(pixels, [])
    let context = CGContext(
      data: CVPixelBufferGetBaseAddress(pixels),
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(pixels),
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
        | CGBitmapInfo.byteOrder32Little.rawValue)!
    context.draw(image(url), in: CGRect(x: 0, y: 0, width: width, height: height))
    CVPixelBufferUnlockBaseAddress(pixels, [])
    adaptor.append(pixels, withPresentationTime: CMTime(value: Int64(index), timescale: fps))
  }
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
guard writer.status == .completed else { fatalError("writing failed: \(String(describing: writer.error))") }
print("\(out.path): \(frames.count) frames, \(width)x\(height), \(fps) fps")
