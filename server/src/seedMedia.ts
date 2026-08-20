/**
 * 种子留言的媒体对象存储 key（由 server/scripts/seed-media-*.ts 一次性生成上传）。
 * key 指向平台对象存储，详情接口按需生成签名 URL，key 本身不过期。
 */
export const SEED_MEDIA = {
  /** 宿舍楼下的灯（seed-15） */
  dormLamp: 'seed-dorm-lamp_ac1762c5.jpg',
  /** 银杏大道的秋（seed-27） */
  ginkgo: 'seed-ginkgo_57fc4727.jpg',
  /** 西山的二月兰（seed-40） */
  eryueLan: 'seed-eryuelan_75f3516b.jpg',
  /** 傍晚的令希图书馆窗边（seed-04，短视频） */
  librarySunset: 'seed-library-sunset_16ade532.mp4',
  /** 喷泉的水花（seed-33，短视频） */
  fountain: 'seed-fountain_ef4af2ec.mp4',
};
