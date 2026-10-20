# 横置礼单本字体包（分包 `packages/fonts`，name: `fonts`）

本目录是横置礼单本的三款字体「常用字预生成包」（常用字子集 WOFF2），
**独立成一个分包**，不占主包体积（主包 2MB 上限）。用户在样式面板选中哪款，
运行时才经 `services/font-manager.js` → `services/font-source.js` 加载哪款。

## 文件清单

| 文件 | 说明 |
|---|---|
| `lxgw-wenkai.woff2` | 霞鹜文楷 LXGW WenKai（github.com/lxgw/LxgwWenKai） |
| `mashanzheng.woff2` | 马善政毛笔体 Ma Shan Zheng（Google Fonts） |
| `longcang.woff2` | 龙藏体 Long Cang（Google Fonts；按同一字表子集化，其中 3 个生僻姓字该字体本身没有字形，运行时走回退链显示，不出方框） |
| `charset.txt` | 子集字表（721 字，见下） |
| `OFL-1.1.txt` | SIL Open Font License 1.1 许可证副本（三款字体均为 OFL 1.1 发布） |

页面署名（样式面板底部）：横置礼单本字体：霞鹜文楷、马善政毛笔体、龙藏体（SIL OFL 1.1）

## 子集字表（charset.txt）

共 **721 字**，构成为：

- **百家姓**常用姓氏字；
- **高频姓名用字**（名字里常见的字）；
- **大写金额字**：壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分整零 等；
- 少量礼单场景字（贺礼、奠仪、礼金等）。

`charset.txt` 是从当前发布的 `lxgw-wenkai.woff2` 的 cmap 反导出的权威副本，
三款字体共用同一字表；如需增删字，改这个文件后按下面命令重做三个包，
并把新字表覆盖回本文件保持一致。

## 构建命令（fonttools / pyftsubset）

```bash
pip install fonttools brotli

# 原始字体（全字库）路径示例：
#   霞鹜文楷   LxgwWenKai-Regular.ttf   （github.com/lxgw/LxgwWenKai）
#   马善政毛笔体 MaShanZheng-Regular.ttf （Google Fonts）
#   龙藏体     LongCang-Regular.ttf      （Google Fonts）

pyftsubset <原始字体>.ttf \
  --text-file=charset.txt \
  --flavor=woff2 \
  --output-file=<目标>.woff2 \
  --layout-features='*' \
  --no-hinting

# 例：
pyftsubset LxgwWenKai-Regular.ttf  --text-file=charset.txt --flavor=woff2 --output-file=lxgw-wenkai.woff2  --layout-features='*' --no-hinting
pyftsubset MaShanZheng-Regular.ttf --text-file=charset.txt --flavor=woff2 --output-file=mashanzheng.woff2 --layout-features='*' --no-hinting
pyftsubset LongCang-Regular.ttf    --text-file=charset.txt --flavor=woff2 --output-file=longcang.woff2    --layout-features='*' --no-hinting
```

注意：龙藏体原字体对字表中 3 个生僻姓字（垚/郈/郤）本身就没有字形，
子集里自然也没有——运行时由 `font-manager` 的回退链（所选字体→楷体→宋体）
逐字回退显示，**不会出现方框**，无需处理。

## 运行时来源（适配层）

字体来源的优先级、云存储开关（`CLOUD_FONT_BASE`）都在
`miniprogram/services/font-source.js`，页面与横置代码只调
`font-manager` 的接口，不直接引用本目录路径。
