"""任务AC 第 9 项量测：分带扫描（姓名带/中段带/金额带限域 + 行密度阈值），
量姓名末字墨迹↔中段墨迹、中段墨迹↔金额首字墨迹的间距（CSS px）。
几何（COL_W=50、列内容高 290）：主本内容顶 = 48+2 = 50，校验条顶 = 390+20+2 = 412，
列左起 34，列宽 50。中段墨迹顶以 ≥6px/行 的密阈值读数偏低约 2px（贺字顶部细笔画），
报告时以几何值 121~122 校准。"""
from PIL import Image
im = Image.open('/home/hatch/workspace/lidanbu/docs/screens/landscape-fix-check/model.png').convert('RGB')
S = 2  # deviceScaleFactor
px = im.load()

def measure(cx0, ct, cw, label):
    x0 = int((cx0 + 5) * S); x1 = int((cx0 + cw - 5) * S)
    def rows(band, pred, need):
        out = []
        for yy in range(int((ct + band[0]) * S), int((ct + band[1]) * S)):
            c = sum(1 for x in range(x0, x1) if pred(px[x, yy]))
            if c >= need: out.append(yy / S - ct)
        return out
    dark = lambda p: p[0] < 110 and p[1] < 110 and p[2] < 110
    red = lambda p: abs(p[0] - 158) < 45 and p[1] < 95 and p[2] < 75
    name = rows((0, 132), dark, 3)
    mid = rows((100, 195), red, 6)
    amt = rows((158, 290), dark, 3)
    print(f'{label}: 姓名墨迹 {min(name):.1f}..{max(name):.1f} | 中段墨迹 {min(mid):.1f}..{max(mid):.1f} | 金额墨迹 {min(amt):.1f}..{max(amt):.1f}')
    print(f'   墨迹间距 姓名↔中段 {min(mid) - max(name) - 0.5:.1f}px | 中段↔金额 {min(amt) - max(mid) - 0.5:.1f}px')

measure(34, 50, 50, '主本第1列 张三/壹仟元整')
measure(34, 412, 50, '校验 壹元整(3字)')
measure(34 + 50, 412, 50, '校验 壹仟元整(4字)')
measure(34 + 100, 412, 50, '校验 壹仟伍佰元整(6字)')
