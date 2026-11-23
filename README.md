# Tab Manager · 标签页清理

在几个浏览器窗口里查资料，最费时间的往往是逐页确认「哪几个可以关」。Tab Manager 把所有普通窗口的标签页铺成卡片。拖动鼠标就能跨组框选，核对数量后一起关闭。带锁的固定页会自动跳过。

**[下载当前 main 版][main-zip]** · [下载 v2.4.4 发布包][release-zip] · [Chrome / Ego Lite 安装步骤](#安装) · [项目主页](https://ximendatie.github.io/tab-manager/)

## 看一次实际操作

![用示例标签页拖动框选、批量关闭，再撤销关闭；固定页始终保留。](docs/extension-demo.gif)

示例中，选框覆盖了一个固定页和三个普通页。点击「关闭所选」后，固定页仍在。点击「撤销关闭」，三个普通页重新出现。

[查看框选截图](docs/extension-screenshot.png) · [试一遍选择、关闭和撤销](https://ximendatie.github.io/tab-manager/usage.html)

## 批量清理标签页

1. **找到要清理的一批。** 点击工具栏里的「标签页清理」。面板优先沿用浏览器原有分组，其余标签页按域名归类。分组用浅色底纹区分，卡片标题最多显示三行。点击卡片左侧的网站图标可切换到原页核对。
2. **勾选，再关闭。** 点击卡片可逐个勾选，拖动鼠标可一次框选多张，也可以从页面底部空白处向上框选。勾选组名旁的「整组」可选中该组所有普通页。看一眼「关闭所选」按钮上的数量，再点击关闭。
3. **误关时撤销。** 在同一管理页点「撤销关闭」，即可重新打开最近一批关闭的网址。会优先恢复到原窗口。如果原窗口已经关闭，标签页会在管理页所在窗口打开。刷新或关闭管理页会清空这次撤销记录。

### 面板快捷键

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 关闭所选 | `Delete`（⌫） | `Delete` |
| 取消选择 | `Esc` | `Esc` |
| 撤销最近一次关闭 | `⌘ Z` | `Ctrl Z` |

## 安装

1. 要使用上面演示的撤销关闭和三行标题，[下载 main 源码 ZIP][main-zip] 并解压。也可以选择[已发布的 v2.4.4 ZIP][release-zip]。
2. 在 Chrome 或 Ego Lite 的地址栏打开 `chrome://extensions`，开启右上角的「开发者模式」。
3. 点击「加载未打包的扩展程序」，选择包含 `manifest.json` 的文件夹。main 源码解压后是 `tab-manager-main`，v2.4.4 发布包解压后是 `tab-manager`。
4. 打开工具栏的扩展程序菜单，找到「标签页清理」，点击旁边的图钉即可固定。

## 自定义域名和标题

默认以域名作为组名。在 `manifest.json` 同级创建 `domain-labels.local.json`，可以给分组起简称、把多个站点归入同一组，或隐藏卡片标题末尾重复的网站名。下面用食谱网站举例。

```json
{
  "recipes.example.com": {
    "label": "食谱",
    "titleSuffix": " - 烘焙手册"
  },
  "guides.example.com": { "groupWith": "recipes.example.com" },
  "notes.example.com": "笔记"
}
```

这里两个食谱站点会归到「食谱」组，「柠檬蛋糕 - 烘焙手册」在卡片上显示为「柠檬蛋糕」。只想改组名时，像「笔记」一样填一个字符串就行。键使用主机名，省略协议、端口和路径。保存后刷新管理页生效。

## 常见问题

**框选范围里有固定页怎么办？** 固定页用锁图标标记。单选、整组、全选和框选都会跳过固定页，执行关闭前还会再检查一次固定状态。

**标签页标题、网址和简称保存在哪里？** 扩展在本地处理这些数据。个性化配置文件已加入 `.gitignore`，下载后可自行创建。

## FAQ in English

**Can I close tabs across windows and undo a batch?** Tab Manager displays tabs from all normal windows in your current Chrome or Ego Lite profile. Drag to select cards across groups, then click **关闭所选** to close them. Pinned tabs stay open. In the current `main` version, **撤销关闭** reopens the URLs from the last batch while the manager page remains open.

**How do I install it?** Unzip the download, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select the folder containing `manifest.json`.

[main-zip]: https://github.com/ximendatie/tab-manager/archive/refs/heads/main.zip
[release-zip]: https://github.com/ximendatie/tab-manager/releases/download/v2.4.4/tab-manager-v2.4.4.zip
