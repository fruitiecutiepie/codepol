import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/codepol/',
  title: 'Codepol',
  description: 'Policy-driven code enforcement for TypeScript projects',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' }
    ],
    sidebar: [
      {
        text: 'Documentation',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Policy Schema', link: '/policy-schema' },
          { text: 'API Reference', link: '/api-reference' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/fruitiecutiepie/codepol' }
    ]
  }
})
