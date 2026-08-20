/**
 * 一次性脚本：生成种子留言视频并上传对象存储，输出 mediaKey。
 * 用法：pnpm exec tsx scripts/seed-media-videos.ts
 */
import { VideoGenerationClient, Config, S3Storage } from 'coze-coding-dev-sdk';
import { writeFileSync } from 'node:fs';

const JOBS: Array<{ field: string; prompt: string; fileName: string }> = [
  {
    field: 'librarySunset',
    fileName: 'seed-library-sunset.mp4',
    prompt:
      '手机竖屏随手拍：傍晚大学图书馆靠窗的空座位，夕阳金色光线洒在木桌面上，窗外天空橙紫渐变，镜头非常缓慢地扫过桌面，空无一人，安静治愈的氛围',
  },
  {
    field: 'fountain',
    fileName: 'seed-fountain.mp4',
    prompt:
      '手机竖屏随手拍：夜晚大学校园喷泉的水花在暖黄色灯光下跃起又落回，水面倒影轻轻摇曳，安静治愈的夜晚氛围，镜头固定',
  },
];

async function genOne(job: (typeof JOBS)[number]): Promise<string> {
  const config = new Config();
  const client = new VideoGenerationClient(config);
  const storage = new S3Storage();

  console.log(`[gen] ${job.field} ...`);
  const content = [{ type: 'text' as const, text: job.prompt }];
  const response = await client.videoGeneration(content, {
    duration: 5,
    ratio: '9:16',
    resolution: '720p',
  });
  if (!response.videoUrl) {
    throw new Error(`生成失败 ${job.field}: ${response.response?.error_message ?? 'unknown'}`);
  }
  const buf = Buffer.from(await (await fetch(response.videoUrl)).arrayBuffer());
  const key = await storage.uploadFile({
    fileContent: buf,
    fileName: job.fileName,
    contentType: 'video/mp4',
    folderName: 'cidi-seeds',
  });
  writeFileSync(`/tmp/${job.fileName}`, buf);
  console.log(`[ok] ${job.field} -> ${key}`);
  return key;
}

async function main() {
  const [librarySunset, fountain] = await Promise.all(JOBS.map(genOne));
  console.log('\n=== 填入 server/src/seedMedia.ts ===');
  console.log(`librarySunset: '${librarySunset}',`);
  console.log(`fountain: '${fountain}',`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
