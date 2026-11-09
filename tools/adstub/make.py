# Односекундная заглушка «Реклама заблокирована» для плеера YouTube: pages/adstub.webm. Запуск: python3 tools/adstub/make.py (нужны Pillow и ffmpeg)
import subprocess, os
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 640, 360, 25
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'pages', 'adstub.webm')
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 36)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)

def frame(i):
	k = min(1, i / 8)  # плавное появление
	img = Image.new('RGB', (W, H), (22, 22, 29))
	d = ImageDraw.Draw(img)
	mix = lambda c: tuple(int(22 + (v - 22) * k) for v in c)
	d.rounded_rectangle((60, 110, W - 60, 250), radius=18, outline=mix((166, 180, 255)), width=3)
	d.text((W / 2, 168), 'Реклама заблокирована', font=font, fill=mix((232, 232, 240)), anchor='mm')
	d.text((W / 2, 214), 'Problet', font=small, fill=mix((154, 154, 176)), anchor='mm')
	return img.tobytes()

p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
	'-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-pix_fmt', 'yuv420p', '-an', '-t', '1', OUT], stdin=subprocess.PIPE)
for i in range(FPS):
	p.stdin.write(frame(i))
p.stdin.close()
p.wait()
