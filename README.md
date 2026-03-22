# FastAdmin 插件开发监听器

> 这是一个用于 FastAdmin 插件开发的监听器工具，能够监视预设的插件目录下文件的变化，并在文件发生变化时执行同步操作，以保证插件文件夹内容可直接打包发布。

## 使用方法

1. 在项目的 `package.json` 文件中添加以下脚本命令：

```json
"scripts": {
    "dev": "node plugin-dev-watch.js"
}
```

2. 运行以下命令来启动监听器：

```bash
npm run dev [插件目录名称]
```

其中 `[插件目录名称]` 是你要监听的插件目录的名称，例如：

```bash
npm run dev test
```

即可监听 `addons/test` 目录下的文件变化，当有文件发生变化时，会自动执行同步操作。