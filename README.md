# Tab Manager · 标签页清理

**[直接下载 v2.4.1 ZIP][release-zip]** · [安装步骤（Chrome / Ego Lite）](#安装)

浏览器开了好几个窗口，临时查资料的标签页散得到处都是。逐个翻找再关，既慢又容易关掉还要用的页面。Tab Manager 把各窗口的标签页铺在同一个面板里，优先沿用浏览器已有的标签页分组，其余按域名归类。你可以选好一批一起关，已固定的标签页会保留。

[项目主页 · Project website](https://ximendatie.github.io/tab-manager/)

## 使用演示

### 插件实拍

![标签页清理实拍动图。域名分组标题旁显示网站图标，跨组框选五个普通标签页并关闭后，带锁的「常用换算表」仍留在面板里。](docs/extension-demo.gif)

动图录自当前源码，使用十个示例标签页。域名分组标题旁有组内网页的图标。拖动跨组框选并点击「关闭所选」后，五个普通页被关闭，已固定的「常用换算表」仍在。

### 交互指南

[![标签页清理使用图：打开分类面板，点击卡片、拖动框选或勾选整组，最后关闭所选并保留固定标签页](docs/usage.png)](https://ximendatie.github.io/tab-manager/usage.html)

[打开交互演示](https://ximendatie.github.io/tab-manager/usage.html)，任选一种选择方式，再点击「关闭所选」看结果。演示使用示例标签页。

## 安装

1. [下载 v2.4.1 ZIP][release-zip] 并解压。
2. 在 Chrome 或 Ego Lite 的地址栏打开 `chrome://extensions`，开启右上角的「开发者模式」。
3. 点击「加载未打包的扩展程序」，选择解压后包含 `manifest.json` 的 `tab-manager` 文件夹。
4. 从浏览器工具栏的扩展程序菜单打开「标签页清理」。常用的话，可以点击菜单里的图钉把它固定在工具栏。

## 批量清理标签页

1. **打开面板。** 点击工具栏里的扩展图标。面板汇总当前浏览器个人资料中各窗口的标签页。已有分组沿用原组名，未分组的标签页按域名归类。
2. **选出要关闭的标签页。** 点击卡片或复选框可逐个勾选。从卡片或空白处按住鼠标左键拖动可框选多张，框选可以累加。要处理整个分组，勾选组标题旁的「整组」。
3. **核对后关闭。** 点击卡片左侧的「↗」可切换到原标签页查看。确认勾选项后，点击「关闭所选」。想重新选时可以点「取消选择」，也可以按 `Esc`。

已固定的标签页会从单选、整组、框选和全选中排除。执行批量关闭前，扩展会再检查一次固定状态。

## 自定义域名组名

默认显示原域名。需要简称时，在 `manifest.json` 同级创建 `domain-labels.local.json`，键填主机名，值填组名。主机名不用写协议、端口或路径，带 `www.` 的地址归入同一组，其他子域名各成一组。

```json
{ "<域名>": "<显示名称>" }
```

保存后刷新管理页。简称只用在按域名归类的组，悬停组名可以查看原域名。配置缺失、格式有误或某个域名未配置时，页面显示原域名。

扩展在本地处理标签页标题、地址和域名简称。配置文件已加入 `.gitignore`，安装说明见本页及 GitHub Release。

## 常见问题

### 能跨窗口批量关闭标签页吗？

可以。面板会汇总当前浏览器个人资料里各个普通窗口的标签页。你可以跨组拖动框选，也可以点击卡片或使用「整组」，再点击「关闭所选」。

### 固定标签页会被框选或关闭吗？

固定页会留在面板里并标有锁。即使框选范围覆盖了固定页，它也不会被选中。点击「关闭所选」后，扩展会再次检查固定状态并跳过已固定的标签页。

### 怎么在 Chrome 或 Ego Lite 安装？

从 GitHub Releases 下载扩展 ZIP 并解压。在地址栏打开 `chrome://extensions`，开启「开发者模式」，点击「加载未打包的扩展程序」，选择包含 `manifest.json` 的目录。

### 标签页标题和域名简称会上传吗？

扩展在本地处理标签页标题和网址。域名简称从本地配置文件读取，未配置时显示原域名。

## FAQ in English

### Can I close tabs across multiple browser windows?

Yes. The dashboard lists tabs from every normal window in the current browser profile. Drag a selection box across groups, click individual cards, or select an entire group, then click **Close selected** (`关闭所选`).

### Does bulk closing affect pinned tabs?

Pinned tabs stay open. Their cards show a lock and are skipped when you drag-select tabs. The extension checks pin status again before closing the selected tabs.

### How do I install Tab Manager in Chrome or Ego Lite?

Download and unzip the extension from GitHub Releases. Open `chrome://extensions`, turn on **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`.

### Does the extension upload my tab titles or domain aliases?

The extension processes tab titles and URLs locally. Custom group labels are read from a local configuration file. If none is configured, groups display their domain names.

[release-zip]: https://github.com/ximendatie/tab-manager/releases/download/v2.4.1/tab-manager-v2.4.1.zip
