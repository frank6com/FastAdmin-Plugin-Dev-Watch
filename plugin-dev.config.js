// 插件开发配置文件
module.exports = {
  // 默认插件配置
  defaultPlugin: 'testplugin',

  // 双向同步配置
  bidirectional: {
    // 防抖时间(毫秒) - 文件写入后忽略对端同名文件变更的时间窗口，防止循环触发
    debounceMs: 2000,
    // 时间戳容差(毫秒) - 两边文件修改时间差在此范围内视为相同，不触发同步
    toleranceMs: 1000,
    // 冲突策略: 'newer' = 以较新文件为准, 'source' = 以开发位置为准, 'target' = 以插件目录为准
    conflictStrategy: 'newer',
  },

  // 路径映射模板
  // source: 开发位置 (application/public 下)
  // target: 插件打包位置 (addons/{plugin}/ 下的相对路径)
  pathTemplates: {
    admin_controller: {
      source: 'application/admin/controller/{plugin}/',
      target: 'application/admin/controller/{plugin}/'
    },
    admin_model: {
      source: 'application/admin/model/{plugin}/',
      target: 'application/admin/model/{plugin}/'
    },
    admin_view: {
      source: 'application/admin/view/{plugin}/',
      target: 'application/admin/view/{plugin}/'
    },
    admin_lang: {
      source: 'application/admin/lang/zh-cn/{plugin}/',
      target: 'application/admin/lang/zh-cn/{plugin}/'
    },
    backend_js: {
      source: 'public/assets/js/backend/{plugin}/',
      target: 'public/assets/js/backend/{plugin}/'
    },
    static_assets: {
      source: 'public/assets/addons/{plugin}/',
      target: 'assets/'
    },
    // 可以继续添加其他路径模板
    api_controller: {
      source: 'application/api/controller/{plugin}/',
      target: 'application/api/controller/{plugin}/'
    }
  }
};