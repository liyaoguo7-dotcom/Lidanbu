from PIL import Image
im = Image.open('/home/hatch/workspace/lidanbu/docs/screens/landscape-fix-check/model.png').convert('RGB')
S = 2  # deviceScaleFactor
W, H = im.size
px = im.load()
def is_ink(x, y):
    r, g, b = px[x, y]
    return r < 110 and g < 110 and b < 110
def is_red(x, y):
    r, g, b = px[x, y]
    return r > 120 and r - g > 40 and r - b > 40

def measure(col_x0_css, top_css, label):
    # 列内区：content top..bottom（CSS px），列 x 区间内缩 3px 避开红列线
    ct, cb = top_css, top_css + 290
    x0 = int((col_x0_css + 3) * S); x1 = int((col_x0_css + 53) * S)
    ink_top = ink_bot = None
    for y in range(int(ct * S), int(cb * S)):
        for x in range(x0, x1):
            if is_ink(x, y):
                if ink_top is None: ink_top = y
                ink_bot = y
    top_blank = (ink_top - ct * S) / S
    bot_blank = (cb * S - 1 - ink_bot) / S
    # 中段红字墨迹 bbox（列中段带）
    reds = [y for y in range(int((ct + 105) * S), int((cb - 105) * S)) for x in range(x0, x1) if is_red(x, y)]
    mid_center = ((min(reds) + max(reds)) / 2) / S
    col_center = (ct + cb) / 2
    print(f'{label}: 姓名首字上空白 {top_blank:.1f}px | 「整」字下空白 {bot_blank:.1f}px | 差 {abs(top_blank - bot_blank):.1f}px | 中段墨迹中心 {mid_center:.1f} vs 列中心 {col_center:.1f} | 差 {abs(mid_center - col_center):.1f}px')

# 主本第一列（张三 壹仟元整）：paper content 左 = 32+2 = 34，顶 = 48+2 = 50
measure(34, 50, '主本·第1列 张三')
# 校验条：顶 = 390+20+2 = 412；三列依次为 壹元整/壹仟元整/壹仟伍佰元整
measure(34, 412, '校验·壹元整(3字)')
measure(34 + 56, 412, '校验·壹仟元整(4字)')
measure(34 + 112, 412, '校验·壹仟伍佰元整(6字)')
