#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
礼单簿 · 横置卷轴杆重绘（AU批，2026-10-27）

用户定版提取规则：只从参考图取「颜色、纹路、帽子造型」三样，尺寸/粗细一律
按现行资产几何——88×836、帽 23 行＋杆身 790 行＋帽 23 行、杆身实绘 x∈[15,72]
（宽 58）、整图实绘不出 [11,76]。AT 批 SCROLL_GEOM / scrollLayout 不动。

搭配（用户 2026-10-27 拍板）：红款→传统经典 classic、金款→祥云金 cloud、
墨黑款→白事 funeral。直接覆盖对应主题现行 PNG（scrollImg 引用不变）。

参考来源（用户提供、带抖音水印的整幅构图，只提取设计语言、不裁图）：
- 红款：朱红杆身卷草纹满布、深红小圆柱帽、纸桃粉（图只取下半幅红卷轴）。
- 金款：金色一件式轴头（圆顶球头＋一层宽盘＋短收颈，AW 批按参考图重绘——
  初版画成小球＋两层盘＋底环的多层堆叠，与参考图不符，已删）、米金杆身、极淡祥云纹。
- 墨黑款：炭黑杆身、圆球帽、帽下与近底浅灰祥云纹带。

画法：4 倍超采样绘制 → 缩回 88×836 → 用逐行轮廓（本文件 CAPS/SHAFT 定义）
生成硬 alpha 蒙版，保证量测几何与原六图一致（杆身每行完整覆盖 [15,72]）。
运行：python3 tools/draw-scrolls.py（在仓库根执行）
"""
import math
import os
from PIL import Image, ImageDraw

SS = 4                      # 超采样倍数
W, H = 88, 836
SHAFT = (15, 72)            # 杆身实绘 x 区间（行 23..812）
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      '..', 'miniprogram', 'assets', 'scrolls')

# ---------- 帽区逐行轮廓（行 0..22，(xmin, xmax)；底帽为顶帽垂直镜像） ----------
GOLD_CAP = [  # 一件式车削轴头（AW 按金款参考图重定）：圆顶球头＋一层宽盘（伞状外张）＋短收颈直入杆身
    (34, 53), (28, 59), (24, 63), (22, 65), (22, 65), (24, 63), (27, 60),  # 球头 0..6（宽 44、上下收圆）
    (19, 68), (14, 73), (11, 76), (11, 76), (13, 74), (17, 70), (22, 65),  # 宽盘 7..13（全帽最宽 66、凸面外张后收）
    (28, 59), (27, 60), (27, 60), (27, 60), (28, 59),                      # 短收颈 14..18（宽约 32）
    (26, 61), (23, 64), (18, 69), (15, 72),                                # 颈下张接杆身 19..22
]
CHAR_CAP = [  # 圆球帽：圆顶球体（宽 50、下缘微收）＋环带＋底环
    (37, 50), (33, 54), (29, 58), (26, 61), (24, 63), (22, 65),
    (21, 66), (20, 67), (20, 67), (19, 68), (19, 68), (19, 68),
    (20, 67), (22, 65), (26, 61), (31, 56),
    (24, 63), (24, 63), (24, 63), (24, 63),
    (19, 68), (16, 71), (15, 72),
]
RED_CAP = [   # 深红小圆柱帽＋颈＋领环
    (32, 55), (30, 57), (29, 58), (29, 58), (29, 58), (29, 58),
    (29, 58), (29, 58), (29, 58), (29, 58), (29, 58), (29, 58),
    (29, 58), (29, 58), (29, 58), (29, 58),
    (33, 54), (33, 54), (33, 54),
    (24, 63), (20, 67), (16, 71), (15, 72),
]
CAPS = {'gold': GOLD_CAP, 'char': CHAR_CAP, 'red': RED_CAP}
for _k, _c in CAPS.items():
    assert len(_c) == 23, _k


def silhouette(kind):
    """整图逐行轮廓：顶帽 23＋杆身 790＋底帽（镜像）23。"""
    top = CAPS[kind]
    rows = list(top)
    rows += [SHAFT] * (813 - 23)
    rows += [top[22 - i] for i in range(23)]
    assert len(rows) == H
    return rows


# ---------- 绘制工具（坐标均为原生单位，内部乘 SS） ----------
def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def grad_color(stops, t):
    """stops: [(pos0..1, (r,g,b)), ...]"""
    if t <= stops[0][0]:
        return stops[0][1]
    for i in range(1, len(stops)):
        if t <= stops[i][0]:
            p0, c0 = stops[i - 1]
            p1, c1 = stops[i]
            return lerp(c0, c1, (t - p0) / max(1e-6, p1 - p0))
    return stops[-1][1]


def cyl_fill(img, x0, x1, y0, y1, stops):
    """水平圆柱渐变填充矩形（原生坐标，x1/y1 为开区间）。"""
    d = ImageDraw.Draw(img)
    for px in range(int(x0 * SS), int(x1 * SS)):
        t = (px / SS - x0) / max(1e-6, (x1 - x0))
        c = grad_color(stops, t)
        d.line([(px, y0 * SS), (px, y1 * SS)], fill=c + (255,))


def overlay_rect(img, x0, x1, y0, y1, rgba):
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rectangle([x0 * SS, y0 * SS, x1 * SS - 1, y1 * SS - 1], fill=rgba)
    img.alpha_composite(layer)


def spiral(img, cx, cy, r, rgba, width=0.9, turns=1.7, tail=True):
    """简易祥云螺旋（原生坐标）：外卷螺旋＋右侧小尾钩，求神似。"""
    pts = []
    steps = 42
    for i in range(steps + 1):
        t = i / steps
        ang = t * turns * 2 * math.pi - math.pi / 2
        rr = r * (0.15 + 0.85 * t)
        pts.append(((cx + rr * math.cos(ang)) * SS, (cy + rr * math.sin(ang)) * SS))
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.line(pts, fill=rgba, width=max(1, int(width * SS)), joint='curve')
    if tail:
        # 螺旋外端向右下拖一条波浪尾
        x_end, y_end = pts[-1][0] / SS, pts[-1][1] / SS
        tail_pts = []
        for i in range(13):
            t = i / 12
            tail_pts.append(((x_end + t * r * 1.15) * SS,
                             (y_end + math.sin(t * math.pi) * r * 0.22 + t * r * 0.18) * SS))
        d.line(tail_pts, fill=rgba, width=max(1, int(width * SS)), joint='curve')
    img.alpha_composite(layer)


def finish(img, kind, path):
    """缩回原生尺寸＋逐行硬蒙版＋保存＋自检量测。"""
    small = img.resize((W, H), Image.LANCZOS)
    rows = silhouette(kind)
    mask = Image.new('L', (W, H), 0)
    md = ImageDraw.Draw(mask)
    for y, (x0, x1) in enumerate(rows):
        md.line([(x0, y), (x1, y)], fill=255)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.paste(small, (0, 0), mask)
    out.save(path, optimize=True)
    # 自检：与原六图同几何
    a = out
    assert a.size == (W, H)
    for y in range(H):
        xs = [x for x in range(W) if a.getpixel((x, y))[3] > 10]
        assert xs, f'{path} 行 {y} 不应全透明'
        assert min(xs) >= 11 and max(xs) <= 76, f'{path} 行 {y} 超出 [11,76]'
        if 23 <= y <= 812:
            assert min(xs) <= 15 and max(xs) >= 72, f'{path} 杆身行 {y} 未覆盖 [15,72]'
            row_alpha = [a.getpixel((x, y))[3] for x in range(15, 73)]
            assert min(row_alpha) > 10, f'{path} 杆身行 {y} 有空洞'
    print('OK', os.path.basename(path), os.path.getsize(path), 'bytes;',
          'shaft(43,400)=', a.getpixel((43, 400)), 'cap(43,11)=', a.getpixel((43, 11)))


def mirror_bottom_cap(img, kind):
    """把顶帽图层（行 0..23）垂直镜像贴到行 813..836。"""
    top = img.crop((0, 0, W * SS, 23 * SS)).transpose(Image.FLIP_TOP_BOTTOM)
    img.alpha_composite(top, (0, 813 * SS))


# ---------- 金款（→ cloud 祥云金）：一件式金轴头＋米金杆身＋极淡祥云 ----------
def draw_gold():
    img = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    gold_cap = [(0.0, (122, 78, 16)), (0.25, (201, 150, 46)), (0.5, (242, 206, 122)),
                (0.75, (201, 150, 46)), (1.0, (122, 78, 16))]
    shaft = [(0.0, (216, 184, 120)), (0.18, (237, 217, 168)), (0.5, (248, 238, 211)),
             (0.82, (237, 217, 168)), (1.0, (207, 169, 94))]
    cyl_fill(img, 11, 77, 0, 23, gold_cap)                    # 帽身
    cyl_fill(img, 15, 73, 23, 813, shaft)                     # 杆身
    # 一件式轴头明暗（AW，仿参考图：亮金高光在球顶与盘面凸部、盘下与颈部压暗）
    overlay_rect(img, 30, 58, 0.8, 3.0, (255, 246, 214, 110))   # 球头正面高光
    overlay_rect(img, 33, 55, 0.4, 1.6, (255, 246, 214, 170))    # 球顶高光点
    overlay_rect(img, 20, 68, 6.5, 7.1, (110, 72, 12, 120))     # 球头与宽盘间的凹线
    overlay_rect(img, 13, 75, 8.4, 10.2, (255, 240, 200, 120))   # 宽盘凸面高光带
    overlay_rect(img, 17, 71, 11.6, 13.4, (120, 80, 16, 90))     # 宽盘下表面压暗
    overlay_rect(img, 26, 62, 14.0, 19.2, (110, 74, 14, 80))     # 短收颈压暗
    # 杆身装饰环带（旧模环位 41..52 / 783..794，带内侧）
    for (y0, y1) in ((41, 53), (783, 795)):
        overlay_rect(img, 15, 73, y0, y1, (198, 156, 66, 70))
        overlay_rect(img, 15, 73, y0, y0 + 0.8, (150, 110, 40, 120))
        overlay_rect(img, 15, 73, y1 - 0.8, y1, (150, 110, 40, 120))
    # 极淡祥云纹（稀疏）
    for cy in (150, 300, 450, 600, 730):
        spiral(img, 38, cy, 8.5, (198, 158, 70, 60), width=0.85)
        spiral(img, 52, cy + 52, 6.5, (198, 158, 70, 48), width=0.8)
    mirror_bottom_cap(img, 'gold')
    finish(img, 'gold', os.path.join(ASSETS, 'scroll-cloud.png'))


# ---------- 墨黑款（→ funeral 白事）：圆球炭帽＋炭黑杆身＋浅灰祥云纹带 ----------
def draw_char():
    img = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    cap = [(0.0, (19, 19, 22)), (0.3, (63, 64, 70)), (0.5, (90, 91, 98)),
           (0.8, (42, 42, 46)), (1.0, (19, 19, 22))]
    shaft = [(0.0, (30, 30, 33)), (0.2, (51, 51, 56)), (0.5, (74, 74, 80)),
             (0.8, (51, 51, 56)), (1.0, (28, 28, 31))]
    cyl_fill(img, 11, 77, 0, 23, cap)
    cyl_fill(img, 15, 73, 23, 813, shaft)
    # 球面高光＋球底压暗（卖圆润感）＋环带压暗与亮线
    overlay_rect(img, 30, 57, 1.2, 6.0, (218, 218, 224, 105))
    overlay_rect(img, 20, 68, 11.5, 14.8, (0, 0, 0, 90))
    overlay_rect(img, 24, 64, 16, 19.6, (0, 0, 0, 95))
    overlay_rect(img, 24, 64, 15.4, 16.1, (185, 185, 192, 130))
    # 祥云纹带：帽下（行 34..104）与近底（行 732..802），浅灰螺旋成排
    for band_top in (34, 732):
        overlay_rect(img, 15, 73, band_top, band_top + 70, (255, 255, 255, 14))
        for i, cx in enumerate((30, 47, 62)):
            spiral(img, cx, band_top + 20 + (i % 2) * 26, 8 if i != 1 else 9.5,
                   (172, 172, 179, 165), width=0.95)
            spiral(img, cx - 6, band_top + 48 - (i % 2) * 22, 6,
                   (150, 150, 157, 130), width=0.85)
        overlay_rect(img, 15, 73, band_top, band_top + 0.9, (175, 175, 182, 100))
        overlay_rect(img, 15, 73, band_top + 69.1, band_top + 70, (175, 175, 182, 100))
    mirror_bottom_cap(img, 'char')
    finish(img, 'char', os.path.join(ASSETS, 'scroll-funeral.png'))


# ---------- 红款（→ classic 传统经典）：深红小圆柱帽＋朱红杆身卷草纹满布 ----------
def draw_red():
    img = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    cap = [(0.0, (78, 14, 7)), (0.3, (126, 29, 19)), (0.5, (168, 58, 40)),
           (0.8, (126, 29, 19)), (1.0, (78, 14, 7))]
    shaft = [(0.0, (124, 23, 14)), (0.2, (165, 40, 24)), (0.5, (200, 67, 44)),
             (0.82, (165, 40, 24)), (1.0, (120, 21, 13))]
    cyl_fill(img, 11, 77, 0, 23, cap)
    cyl_fill(img, 15, 73, 23, 813, shaft)
    # 卷草纹满布：亮红螺旋阵列＋暗红小螺旋错位
    row = 0
    cy = 52
    while cy < 800:
        spiral(img, 40, cy, 10.5, (226, 104, 76, 95), width=1.0)
        spiral(img, 58 if row % 2 else 27, cy + 34, 6.8, (110, 22, 12, 85), width=0.9)
        cy += 72
        row += 1
    # 装饰环带（旧模环位）
    for (y0, y1) in ((41, 53), (783, 795)):
        overlay_rect(img, 15, 73, y0, y1, (96, 18, 10, 105))
        overlay_rect(img, 15, 73, y0, y0 + 0.8, (255, 170, 140, 85))
        overlay_rect(img, 15, 73, y1 - 0.8, y1, (255, 170, 140, 85))
    # 帽：顶面微光＋颈凹槽＋领环亮线
    overlay_rect(img, 29, 59, 0.3, 1.5, (255, 190, 160, 70))
    overlay_rect(img, 29, 59, 16, 18.6, (40, 5, 2, 150))
    overlay_rect(img, 24, 64, 18.8, 19.5, (244, 144, 112, 130))
    mirror_bottom_cap(img, 'red')
    finish(img, 'red', os.path.join(ASSETS, 'scroll-classic.png'))


if __name__ == '__main__':
    draw_gold()
    draw_char()
    draw_red()
