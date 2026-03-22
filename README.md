# FastAdmin 插件开发监听器

> 这是一个用于 FastAdmin 插件开发的监听器工具，能够监视预设的插件目录下文件的变化，并在文件发生变化时执行同步操作，以保证插件文件夹内容可直接打包发布。

## 功能

- 监听插件目录下的控制器、模型、视图、语言包、JS文件、静态资源文件等位置文件的变化并自动进行双向同步。

- 启动时会自动执行一次同步检查，并提示需要处理的文件列表及合适的操作方式（按时间戳同步、以开发位置为准、以插件位置为准、手动处理）。

## 使用方法

1. 将本项目中的核心文件复制到你的 FastAdmin 项目的根目录下。

2. 在项目的 `package.json` 文件中添加以下脚本命令：

```json
"scripts": {
    "dev": "node plugin-dev-watch.js"
}
```

3. 运行以下命令来启动监听器：

```bash
npm run dev [插件目录名称]
```

其中 `[插件目录名称]` 是你要监听的插件目录的名称，例如：

```bash
npm run dev test
```

即可监听以下目录的文件变化，当有文件发生变化时，会自动执行双向同步操作。

   - `admin`控制器: 
  
       插件目录 `addons/{plugin}/application/admin/controller/{plugin}/`

       应用目录 `application/admin/controller/{plugin}/`

   - `admin`模型: 

       插件目录 `addons/{plugin}/application/admin/model/{plugin}/`

       应用目录 `application/admin/model/{plugin}/`

   - `admin`视图:
  
       插件目录 `addons/{plugin}/application/admin/view/{plugin}/`

       应用目录 `application/admin/view/{plugin}/`

   - `admin`语言包: 
  
       插件目录 `addons/{plugin}/application/admin/lang/zh-cn/{plugin}/`

       应用目录 `application/admin/lang/zh-cn/{plugin}/`

   - `后端JS`文件: 
  
       插件目录 `addons/{plugin}/public/assets/js/backend/{plugin}/`

       应用目录 `public/assets/js/backend/{plugin}/`

   - `静态资源`文件:
  
       插件目录 `addons/{plugin}/assets/`

       应用目录 `/public/assets/addons/{plugin}/`

   - `API控制器`文件:
  
       插件目录 `addons/{plugin}/application/api/controller/{plugin}/`

       应用目录 `application/api/controller/{plugin}/`

可以根据需要修改 `plugin-dev.config.js` 文件中 `pathTemplates` 的监听路径配置，以适应不同的插件结构和需求。