(function exposeTinyPdfI18n(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.TinyPDFI18n = api;
})(typeof window !== "undefined" ? window : globalThis, function createTinyPdfI18n() {
  "use strict";

  const messages = {
    en: {
      compressButton: "Compress PDF",
      compressing: "Compressing...",
      downloadButton: "Download compressed PDF",
      uploadLimit: "Free · No account required · One file up to {max}MB",
      uploadTitle: "Upload a PDF",
      uploadPrompt: "Drag a file here, or click to choose one",
      uploadOne: "Please upload one PDF file at a time",
      validPdf: "Please choose a valid PDF file",
      pdfOnly: "Only PDF files are supported",
      fileTooLarge: "File is too large. The current limit is {max}MB",
      targetRequired: "Enter a target file size",
      targetNumber: "Enter a valid number",
      targetPositive: "Target size must be greater than 0",
      targetSmaller: "Target size must be smaller than the original file",
      targetSize: "Target size",
      qualityWarning: "This target is very small, so the file may lose visible quality.",
      preparing: "Preparing",
      waiting: "Waiting for the job to start",
      statusComplete: "Compression complete",
      statusFailed: "Compression failed",
      statusProcessing: "Processing",
      checkingFile: "Checking the file",
      uploadingFile: "Uploading the file",
      fileUploaded: "File uploaded",
      startingCompression: "Starting compression",
      applyingStrongerCompression: "Applying stronger compression",
      searchingClearest: "Searching for the clearest version that fits the target size...",
      originalAlreadySmall: "The original file is already no larger than the target size",
      limitedCompression: "The file has limited room for compression. This is the smallest usable result we could produce.",
      serverBusy: "The server is busy. Please try again later.",
      rasterizedNote: "Note: to reach the target size, pages were converted to images, so sharpness may be lower.",
      metricOriginal: "Original size",
      metricTarget: "Target size",
      metricResult: "Compressed size",
      metricRatio: "Compression ratio",
    },
    "zh-CN": {
      compressButton: "开始压缩",
      compressing: "正在压缩…",
      downloadButton: "下载压缩后的 PDF",
      uploadLimit: "免费使用 · 无需注册 · 单个文件最高 {max}MB",
      uploadTitle: "上传 PDF",
      uploadPrompt: "拖入文件，或点击选择",
      uploadOne: "每次只能上传一个 PDF 文件",
      validPdf: "请选择有效的 PDF 文件",
      pdfOnly: "仅支持 PDF 文件",
      fileTooLarge: "文件过大，当前上限为 {max}MB",
      targetRequired: "请输入目标文件大小",
      targetNumber: "请输入有效数字",
      targetPositive: "目标大小必须大于 0",
      targetSmaller: "目标大小必须小于原文件",
      targetSize: "目标大小",
      qualityWarning: "目标设置过小时，文件清晰度可能会下降。",
      preparing: "准备中",
      waiting: "等待任务开始",
      statusComplete: "压缩完成",
      statusFailed: "压缩失败",
      statusProcessing: "处理中",
      checkingFile: "正在检查文件",
      uploadingFile: "正在上传文件",
      fileUploaded: "文件上传完成",
      startingCompression: "开始压缩",
      applyingStrongerCompression: "正在加强压缩",
      searchingClearest: "正在寻找符合目标大小的最清晰版本…",
      originalAlreadySmall: "原文件已经不大于目标大小",
      limitedCompression: "该文件可压缩空间有限，已返回目前能生成的最小可用版本。",
      serverBusy: "服务器繁忙，请稍后再试。",
      rasterizedNote: "为尽量接近目标大小，页面已转为图片，清晰度可能会降低。",
      metricOriginal: "原文件大小",
      metricTarget: "目标大小",
      metricResult: "压缩后大小",
      metricRatio: "压缩比例",
    },
  };

  function normalizeLanguage(language) {
    return String(language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  }

  function format(template, vars = {}) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => (
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : ""
    ));
  }

  function createTranslator(language) {
    const normalized = normalizeLanguage(language);
    return {
      language: normalized,
      text(key, vars) {
        const template = messages[normalized][key] || messages.en[key] || key;
        return format(template, vars);
      },
    };
  }

  return { createTranslator, messages };
});
