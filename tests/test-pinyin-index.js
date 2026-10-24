'use strict';
/** 亲友录字母分组改准 + 右侧快选接线（2026-10-24 用户定：分组一起改准） */
const { test } = require('./fw');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pinyinInitial, compareGroupKey } = require('../miniprogram/services/pinyin-initial.js');

test('拼音分组：常见姓氏与复姓按姓氏读音归位', () => {
  const cases = {
    李总: 'L', 马超: 'M', 周涛: 'Z', 张超: 'Z', 郭总: 'G', 郑姐: 'Z', 韩梅梅: 'H',
    冯巩: 'F', 龚自珍: 'G', 薄冰: 'B', 欧阳娜娜: 'O', 司马光: 'S', 诸葛亮: 'Z',
    单田芳: 'S', 解晓东: 'X', 查良镛: 'Z', 区瑞强: 'O', 仇英: 'Q', 朴树: 'P',
    覃海洋: 'Q', 乐嘉: 'Y', 尉迟恭: 'Y', 万俟卨: 'M', 澹台灭明: 'T', 第五人格: 'D',
    钟南山: 'Z', 夏雨: 'X', 雷军: 'L', 武松: 'W', 易烊: 'Y', 卫青: 'W',
  };
  for (const [name, want] of Object.entries(cases)) {
    assert.strictEqual(pinyinInitial(name), want, `${name} 应归 ${want}`);
  }
  assert.strictEqual(pinyinInitial('Alice'), 'A', '英文名取首字母');
  assert.strictEqual(pinyinInitial('123'), '#', '数字开头归 #');
  assert.strictEqual(pinyinInitial(''), '#', '空名归 #');
});

test('拼音分组：# 永远排最后，其余 A-Z 升序', () => {
  assert.deepStrictEqual(['Z', '#', 'L', 'A'].sort(compareGroupKey), ['A', 'L', 'Z', '#']);
});

test('亲友录字母栏接线：锚点/字母栏/气泡/触摸处理齐全', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/contacts/contacts.wxml'), 'utf8');
  assert(wxml.includes('id="anchor-'), '分组标题应带锚点 id');
  assert(wxml.includes('class="index-bar"'), '应有右侧字母栏');
  assert(wxml.includes('bindtouchmove="onIndexTouch"'), '字母栏应支持滑动选字母');
  assert(wxml.includes('idx-bubble'), '应有居中字母气泡');
  const js = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/contacts/contacts.js'), 'utf8');
  assert(js.includes("require('../../services/pinyin-initial.js')"), '分组应走改准后的共享口径');
  assert(js.includes('pageScrollTo'), '选字母应跳转分组');
});
