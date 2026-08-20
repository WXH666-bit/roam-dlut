import type { MediaType, Message } from './types';
import { SEED_MEDIA } from './seedMedia';

interface SeedDef {
  text: string;
  flowerName: string;
  lat: number;
  lng: number;
  mediaType?: MediaType;
  mediaKey?: string;
  // 预置已读人数（模拟剩余名额差异）
  readers?: number;
}

// 大连理工大学凌水校区地标附近（校园约 2km × 2km）
const SEEDS: SeedDef[] = [
  { text: '2019 级的我在这个窗边背完了整本红宝书。祝下一个坐在这里的人，上岸。', flowerName: '窗边的红宝书', lat: 38.88360, lng: 121.52910, readers: 62 },
  { text: '刘长春先生，您跑过的那条路，现在每天天不亮还是有人在跑。', flowerName: '清晨六点的跑道', lat: 38.88420, lng: 121.52790, readers: 81 },
  { text: '四年前我爸在这栋楼下帮我扛行李，四年后还是这栋楼。别哭，毕业生。', flowerName: '毕业季的旧箱子', lat: 38.88050, lng: 121.52350, readers: 88 },
  { text: '这个位置的夕阳，现在归你了。', flowerName: '黄昏的许愿币', lat: 38.88370, lng: 121.52920, mediaType: 'video', mediaKey: SEED_MEDIA.librarySunset, readers: 45 },
  { text: '考研那年我把这张桌子用便利贴贴满了。撕掉的时候像蜕了一层皮。你贴的东西，将来也会撕得很痛快。', flowerName: '图书馆的荧光笔', lat: 38.88270, lng: 121.52680, readers: 37 },
  { text: '每次路过主楼都走很快，好像走慢了就要被叫进去开会。——一个毕业了三年的人', flowerName: '主楼的回声', lat: 38.88300, lng: 121.52620, readers: 54 },
  { text: 'C 座 301 第三排的桌肚里有一本 2016 年的《信号与系统》，扉页写着「别挂」。它没有等到主人回来拿。', flowerName: '晚自习的草稿纸', lat: 38.88220, lng: 121.52550, readers: 29 },
  { text: '凌晨一点的大工桥，桥洞会把你的声音还给你。试过一次，喊的是「我不想念了」，回来的是「再想想」。', flowerName: '桥上的流星', lat: 38.88180, lng: 121.52700, readers: 71 },
  { text: '喷泉每年只开几次，看到算赚到。本科四年我看了十一次，赢了大多数人。', flowerName: '风里的汽水', lat: 38.88280, lng: 121.52720, mediaType: 'video', mediaKey: SEED_MEDIA.fountain, readers: 33 },
  { text: '十一月的银杏叶落下来的时候，整条路都是黄的。我在这片金黄里挂过科，也在这里被喜欢的人在落叶上写过名字。', flowerName: '银杏道上的猫', lat: 38.88330, lng: 121.52580, readers: 76 },
  { text: '去年今天的银杏。拍照那天我逃了一节课，值。', flowerName: '午夜的闪光灯', lat: 38.88340, lng: 121.52590, mediaType: 'image', mediaKey: SEED_MEDIA.ginkgo, readers: 21 },
  { text: '体测 1000 米，我在这个弯道超过了他，然后假装不在意地慢下来。青春就是干这种蠢事。', flowerName: '操场的旧球鞋', lat: 38.88480, lng: 121.52690, readers: 48 },
  { text: '西门外那家烤冷面，加两个蛋不要葱。毕业五年了，老板还记得我的配方，我不记得他的脸。', flowerName: '西门外的茶叶蛋', lat: 38.88200, lng: 121.52150, readers: 84 },
  { text: '从南门进校的那天我拖着 28 寸的箱子，轮子坏了一个。四年过去，箱子还在床底，轮子还是没修。', flowerName: '开学那天的暖宝宝', lat: 38.87980, lng: 121.52650, readers: 17 },
  { text: '北门的风比南门大两度，不信你站五分钟。这是大工给我的第一个物理实验。', flowerName: '北门的温度计', lat: 38.88600, lng: 121.52700, readers: 40 },
  { text: '研究生三年，这部电梯我认识每一个按 7 楼的人。现在我们散落在六个城市，群名叫「七楼」。', flowerName: '七楼的纽扣', lat: 38.88380, lng: 121.52520, readers: 58 },
  { text: '实验又失败了。导师说数据不好也是数据。把这句话留在这里，给下一个对着烧瓶发呆的人。', flowerName: '化工楼的玻璃瓶', lat: 38.88450, lng: 121.52450, readers: 25 },
  { text: '金工实习磨的那把小锤子，我留了四年。它砸过核桃、钉过海报、修过床板。比我的毕业证用处大。', flowerName: '机械楼的小锤子', lat: 38.88250, lng: 121.52400, readers: 66 },
  { text: '大一那年在大活排练小品，笑场了二十三次。后来再没笑那么大声过。舞台还在，你们替我们笑。', flowerName: '大活的纸飞机', lat: 38.88120, lng: 121.52580, readers: 31 },
  { text: '老图书馆的木头椅子会吱呀响，像在跟你打招呼。坐下去，你就是它认识的新朋友了。', flowerName: '一馆的书签', lat: 38.88320, lng: 121.52650, readers: 19 },
  { text: '三楼的麻辣香锅，阿姨手不抖。这份恩情我记了四年，现在传给能看到这条消息的你。', flowerName: '食堂角落的汤勺', lat: 38.88150, lng: 121.52480, readers: 73 },
  { text: '楼下的猫叫「博导」，因为它看谁都是看学生的眼神。喂它可以，别摸，它有编制。', flowerName: '博留的猫', lat: 38.87950, lng: 121.52300, readers: 90 },
  { text: '在湖边背过英语，也在这里被分过手。湖水什么都没记住，所以什么都可以跟它说。', flowerName: '湖边的火柴', lat: 38.88150, lng: 121.52750, readers: 43 },
  { text: '闭馆音乐是《回家》。四年里它催了我一千多次，最后一次我没有走，在台阶上坐到了熄灯。', flowerName: '熄灯前的月亮', lat: 38.88350, lng: 121.52900, readers: 86 },
  { text: '运动会看台最高那排，风最大，看得最远。我在这里给跑道上的他喊过加油，他到现在都不知道。', flowerName: '看台上的风铃', lat: 38.88490, lng: 121.52700, readers: 27 },
  { text: '冬天洗完澡出来，头发会结冰。这件事我跟南方来的室友说了四年，她每年都要惊讶一次。', flowerName: '雪后的暖壶', lat: 38.88070, lng: 121.52370, readers: 35 },
  { text: '捡球比打球的时间长。教练说捡球也是练。我信了四年，现在捡东西特别快。', flowerName: '网球场的钥匙扣', lat: 38.88400, lng: 121.52600, readers: 12 },
  { text: '学会游泳那天，我在深水区踩了十分钟水。大连的风从窗缝进来，我突然觉得四年够用了。', flowerName: '深水区的回声', lat: 38.88440, lng: 121.52820, readers: 22 },
  { text: '第一节高数课，老师说他教了三十年书，学校的一草一木都认识他。当时觉得是客套，现在我信了。', flowerName: '综教一的粉笔灰', lat: 38.88240, lng: 121.52580, readers: 51 },
  { text: '同桌的陌生人，我们一学期没说一句话，但她每天帮我占座。如果你看到，谢谢。还有，你笔袋上的挂饰很丑。', flowerName: '三楼的小夜灯', lat: 38.88365, lng: 121.52905, readers: 69 },
  { text: '早上六点的操场。大爷跑得比我快，我假装在热身。', flowerName: '操场的自行车铃', lat: 38.88430, lng: 121.52800, readers: 16 },
  { text: '宿舍楼下的这盏灯，看过我四年里最晚的每一次回来。它谁也不等，但总觉得它在等人。', flowerName: '天台的信封', lat: 38.88060, lng: 121.52360, mediaType: 'image', mediaKey: SEED_MEDIA.dormLamp, readers: 39 },
  { text: '西山的二月兰开了，花期只有两周。看到这条的人，算你运气好。', flowerName: '树荫里的萤火', lat: 38.88380, lng: 121.52750, mediaType: 'image', mediaKey: SEED_MEDIA.eryueLan, readers: 78 },
  { text: '拎着暖壶在这里排过的队，够绕操场三圈。现在都用直饮水了，暖壶在阳台积灰，像退伍老兵。', flowerName: '开水房的蒸汽', lat: 38.88100, lng: 121.52450, readers: 24 },
  { text: '发烧 39 度自己来挂水，左手扎针右手刷网课。长大就是这件事，没人教你，自己就会了。', flowerName: '雨后的伞', lat: 38.88220, lng: 121.52380, readers: 44 },
  { text: '在这里拆过家里寄的腊肠，也拆过分手后退回来的礼物。快递点是大工情绪浓度最高的地方。', flowerName: '快递点的胶带', lat: 38.88020, lng: 121.52400, readers: 57 },
  { text: '我的车在这里丢过一次，又被保安大叔找回来了。他说「咱学校丢不了」。我记到现在。', flowerName: '车棚的星星', lat: 38.88180, lng: 121.52480, readers: 14 },
  { text: '15 秒的湖。风是我录进去的，免费送你。', flowerName: '湖边的漂流瓶', lat: 38.88160, lng: 121.52760, readers: 28 },
  { text: '天台的门从来锁不严，这是大工公开的秘密。上来看过星星的人，都不坏。', flowerName: '天台的流星', lat: 38.88260, lng: 121.52560, readers: 63 },
  { text: '拍毕业照那天，我们把帽子扔上去，没人管帽子掉哪了。青春就是不在乎帽子的下落。', flowerName: '毕业季的学士帽', lat: 38.87990, lng: 121.52660, readers: 92 },
];

// 伪随机但确定的预置读者列表：reader-seed-{i}-{k}
const fakeReaders = (seedIndex: number, count: number): string[] =>
  Array.from({ length: count }, (_, k) => `reader-seed-${seedIndex}-${k}`);

export const buildSeedMessages = (now: number): Message[] =>
  SEEDS.map((s, i) => {
    // 创建时间错开：最近 25 天内，越早的种子越"旧"
    const createdAt = now - ((i * 37 + 11) % 25) * 24 * 60 * 60 * 1000 - (i % 9) * 3600_000;
    const hasMedia = !!s.mediaType && !!s.mediaKey;
    return {
      id: `seed-${String(i + 1).padStart(2, '0')}`,
      deviceId: 'seed-device',
      flowerName: s.flowerName,
      text: s.text,
      mediaType: hasMedia ? (s.mediaType as MediaType) : 'none',
      mediaKey: hasMedia ? (s.mediaKey as string) : null,
      lat: s.lat,
      lng: s.lng,
      createdAt,
      readers: fakeReaders(i, Math.min(s.readers ?? 0, 98)),
      likes: fakeReaders(i, Math.min(Math.floor((s.readers ?? 0) / 3), 30)),
    };
  });
