---
name: wechat-article
description: 微信公众号文章提取技能 - 用于从微信文章页面提取干净的 Markdown 内容。触发条件：URL 匹配 https://mp.weixin.qq.com/*
trigger: automatic
---

# 微信公众号文章清洗技能

## 触发条件

- URL 匹配：`https://mp.weixin.qq.com/*`

## 内容清洗规则

### 需要保留的元素

- 文章正文内容（通常在 `#js_content` 中）
- 文章标题
- 作者信息
- 文章正文中的 Markdown 格式（标题、列表、代码块、引用等）

### 必须移除的干扰元素

1. **二维码相关**
   - `#js_pc_qr_code` - PC 端二维码
   - `.follow-article` - 关注公众号区域

2. **广告和推广**
   - `.appmsg_card` - 文章卡片广告
   - `.js-share-article` - 分享区域
   - `.vote_area` - 投票区域

3. **固定元素**
   - `.js-pc` - PC 端固定内容
   - `.mobile-card` - 移动端卡片

4. **页脚和导航**
   - `footer` 元素
   - `nav` 元素
   - `.profile_inner` - 作者信息卡片

5. **其他干扰**
   - 空白的或只有符号的段落
   - 重复的分割线
   - 推广链接

## 输出要求

1. 输出纯 Markdown 格式内容
2. 保留文章的标题结构（使用 `#` 标题）
3. 保留代码块（使用 ``` 包裹）
4. 保留引用区块（使用 `>` 引用）
5. 移除所有 HTML 标签，只保留文本内容
6. 图片使用 `![alt](url)` 格式保留
7. 链接使用 `[text](url)` 格式保留

## 示例

输入（原始提取）可能包含：
```html
<div id="js_content">
  <p>这是正文内容</p>
  <div id="js_pc_qr_code" style="display:none">二维码</div>
  <p class="appmsg_card">广告内容</p>
  <p>更多正文</p>
</div>
```

期望输出（清洗后）：
```markdown
这是正文内容

更多正文
```

## 注意事项

- 微信文章可能有多种格式，灵活处理
- 部分文章需要登录才能查看完整内容
- 优先保留正文，宁可少一些也不要保留广告
