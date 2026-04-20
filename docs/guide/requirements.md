# 环境要求

## 系统要求

### 必需环境

- **操作系统**: macOS 10.15 (Catalina) 或更高版本
- **Node.js**: v14.0 或更高版本
- **Xcode Command Line Tools**: 用于编译 Swift 脚本

### 为什么只支持 macOS？

PDF 压缩功能使用了 macOS 专用的框架：

- **PDFKit**: 苹果官方 PDF 处理框架
- **QuartzFilter**: macOS 图形滤镜系统
- **Core Graphics**: macOS 2D 图形渲染引擎

这些框架在其他操作系统上不可用，因此本工具只能在 macOS 上运行。

## 安装依赖

### 1. 安装 Node.js

访问 [Node.js 官网](https://nodejs.org/) 下载并安装 LTS 版本。

或使用 Homebrew：

```bash
brew install node
```

验证安装：

```bash
node --version
npm --version
```

### 2. 安装 Xcode Command Line Tools

```bash
xcode-select --install
```

如果已安装会提示：

```
xcode-select: error: command line tools are already installed
```

### 3. 验证 Swift 编译器

```bash
swift --version
```

应该输出类似：

```
Apple Swift version 5.x.x
```

## 硬件建议

### 最低配置
- CPU: 双核 Intel 或 Apple Silicon
- 内存: 4GB RAM
- 磁盘: 500MB 可用空间

### 推荐配置
- CPU: 四核或更高
- 内存: 8GB+ RAM
- 磁盘: SSD（处理大文件更快）

## 网络要求

- 首次启动需要下载 Swift 依赖（如有）
- 日常使用不需要网络连接
- GitHub Pages 文档站点需要网络访问
