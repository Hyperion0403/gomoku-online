# 五子棋对战小网页

这是一个纯静态五子棋网页，支持本地双人对战，也支持通过 Supabase Realtime 分享房间在线对战。

## 配置 Supabase

打开 `config.js`，填入你的 Supabase 项目配置：

```js
window.GOMOKU_SUPABASE = {
  url: "https://你的项目.supabase.co",
  anonKey: "你的 anon public key",
};
```

`anon public key` 是公开前端 key，不是 service role key。

## 部署到 Netlify

1. 把项目上传到 GitHub。
2. 在 Netlify 新建站点，选择这个 GitHub 仓库。
3. Build command 留空。
4. Publish directory 填 `.`。
5. 部署完成后打开站点，先选择“我执黑”或“我执白”，再点击“创建房间”，复制邀请链接给好友。

## 本地预览

可以直接双击 `index.html` 玩本地双人模式。

如果要测试联机，建议用一个本地静态服务器打开：

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

然后访问：

```text
http://127.0.0.1:4173/
```
