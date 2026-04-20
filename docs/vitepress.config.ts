import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'PDF压缩神器',
  description: '想多大就多大！PDF一键压缩神器',
  lang: 'zh-CN',

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '使用说明', link: '/guide/usage' },
      { text: '部署指南', link: '/deploy/server' }
    ],

    sidebar: [
      {
        text: '介绍',
        items: [
          { text: '什么是PDF压缩神器', link: '/' },
          { text: '功能特性', link: '/guide/features' }
        ]
      },
      {
        text: '快速开始',
        items: [
          { text: '环境要求', link: '/guide/requirements' },
          { text: '安装部署', link: '/guide/getting-started' },
          { text: '使用说明', link: '/guide/usage' }
        ]
      },
      {
        text: '部署指南',
        items: [
          { text: 'Mac 服务器部署', link: '/deploy/server' },
          { text: '内网穿透', link: '/deploy/network' },
          { text: '域名绑定', link: '/deploy/domain' }
        ]
      },
      {
        text: '常见问题',
        items: [
          { text: 'FAQ', link: '/faq' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/zijinmengli-svg/pdf-compress-web' }
    ],

    footer: {
      message: '基于 MIT 许可证发布',
      copyright: 'Copyright © 2024 PDF压缩神器'
    }
  }
})
