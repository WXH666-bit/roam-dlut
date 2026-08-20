/**
 * 一次性脚本：生成种子留言配图并上传对象存储，输出 mediaKey。
 * 用法：pnpm exec tsx scripts/seed-media-images.ts
 */
import { ImageGenerationClient, Config, S3Storage } from 'coze-coding-dev-sdk';
import { writeFileSync } from 'node:fs';

const JOBS: Array<{ field: string; prompt: string; fileName: string }> = [
  {
    field: 'dormLamp',
    fileName: 'seed-dorm-lamp.jpg',
    prompt:
      '手机随手拍的生活照片：深夜大学宿舍楼门口，一盏暖黄色路灯照亮一小段台阶，周围是深蓝色夜空和楼窗零星的灯光，安静温暖，轻微胶片颗粒感，无人物',
  },
  {
    field: 'ginkgo',
    fileName: 'seed-ginkgo.jpg',
    prompt:
      '手机随手拍的生活照片：秋天大学校园的小路落满金黄色银杏叶，午后阳光斜照，远处有教学楼剪影，画面安静治愈，轻微胶片颗粒感，无人物',
  },
  {
    field: 'eryueLan',
    fileName: 'seed-eryuelan.jpg',
    prompt:
      '手机随手拍的生活照片：春天清晨大学校园后山一大片紫色二月兰花海，薄雾柔光，远处有教学楼轮廓，安静治愈，轻微胶片颗粒感，无人物',
  },
];

async function main() {
  const config = new Config();
  const client = new ImageGenerationClient(config);
  const storage = new S3Storage();

  const results: Record<string, string> = {};

  for (const job of JOBS) {
    console.log(`[gen] ${job.field} ...`);
    const response = await client.generate({ prompt: job.prompt, size: '2K' });
    const helper = client.getResponseHelper(response);
    if (!helper.success || helper.imageUrls.length === 0) {
      throw new Error(`生成失败 ${job.field}: ${helper.errorMessages.join(',')}`);
    }
    const url = helper.imageUrls[0];
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const key = await storage.uploadFile({
      fileContent: buf,
      fileName: job.fileName,
      contentType: 'image/jpeg',
      folderName: 'cidi-seeds',
    });
    results[job.field] = key;
    writeFileSync(`/tmp/${job.fileName}`, buf);
    console.log(`[ok] ${job.field} -> ${key}`);
  }

  console.log('\n=== 填入 server/src/seedMedia.ts ===');
  for (const [field, key] of Object.entries(results)) {
    console.log(`${field}: '${key}',`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
