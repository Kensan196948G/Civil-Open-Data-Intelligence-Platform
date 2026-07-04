import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const INITIAL_TAGS: { name: string; color: string }[] = [
  { name: "災害", color: "#dc2626" },
  { name: "河川", color: "#0ea5e9" },
  { name: "道路", color: "#6b7280" },
  { name: "地形", color: "#92400e" },
  { name: "標高", color: "#b45309" },
  { name: "気象", color: "#2563eb" },
  { name: "交通", color: "#7c3aed" },
  { name: "都市計画", color: "#059669" },
  { name: "3D都市", color: "#0891b2" },
  { name: "維持管理", color: "#4b5563" },
  { name: "施工判断", color: "#ea580c" },
  { name: "工事候補地", color: "#ca8a04" },
  { name: "統計", color: "#9333ea" },
  { name: "自治体", color: "#16a34a" },
  { name: "APIキー必要", color: "#e11d48" },
  { name: "利用条件要確認", color: "#f59e0b" },
];

async function main() {
  // --- Providers ---
  const mlit = await prisma.provider.upsert({
    where: { name: "国土交通省" },
    update: {},
    create: {
      name: "国土交通省",
      organizationType: "national",
      officialUrl: "https://www.mlit.go.jp/",
      country: "日本",
    },
  });
  const gsi = await prisma.provider.upsert({
    where: { name: "国土地理院" },
    update: {},
    create: {
      name: "国土地理院",
      organizationType: "national",
      officialUrl: "https://www.gsi.go.jp/",
      country: "日本",
    },
  });
  const jma = await prisma.provider.upsert({
    where: { name: "気象庁" },
    update: {},
    create: {
      name: "気象庁",
      organizationType: "national",
      officialUrl: "https://www.jma.go.jp/",
      country: "日本",
    },
  });
  const soumu = await prisma.provider.upsert({
    where: { name: "総務省統計局" },
    update: {},
    create: {
      name: "総務省統計局",
      organizationType: "national",
      officialUrl: "https://www.stat.go.jp/",
      country: "日本",
    },
  });
  const osmf = await prisma.provider.upsert({
    where: { name: "OpenStreetMap Foundation" },
    update: {},
    create: {
      name: "OpenStreetMap Foundation",
      organizationType: "community",
      officialUrl: "https://www.openstreetmap.org/",
      country: "国際",
    },
  });
  const jartic = await prisma.provider.upsert({
    where: { name: "日本道路交通情報センター(JARTIC)" },
    update: {},
    create: {
      name: "日本道路交通情報センター(JARTIC)",
      organizationType: "private",
      officialUrl: "https://www.jartic.or.jp/",
      country: "日本",
    },
  });

  // --- Tags ---
  const tagMap = new Map<string, string>();
  for (const t of INITIAL_TAGS) {
    const tag = await prisma.tag.upsert({
      where: { name: t.name },
      update: { color: t.color },
      create: t,
    });
    tagMap.set(tag.name, tag.id);
  }

  // --- Data sources (初期10件) ---
  type SeedSource = {
    providerId: string;
    name: string;
    nameEn?: string;
    description: string;
    officialUrl: string;
    endpointUrl?: string;
    documentationUrl?: string;
    category: string;
    dataFormat: string;
    accessType: string;
    requiresApiKey: boolean;
    apiKeyEnvName?: string;
    licenseName?: string;
    commercialUse: string;
    attributionRequired: boolean;
    updateFrequency?: string;
    trustLevel: number;
    qualityScore: number;
    note?: string;
    tags: string[];
    useCases: { useCaseName: string; targetSystem?: string; description?: string }[];
  };

  const sources: SeedSource[] = [
    {
      providerId: mlit.id,
      name: "国土数値情報",
      nameEn: "National Land Numerical Information",
      description:
        "地形、土地利用、公共施設、交通、災害リスク、都市計画、地価など国土に関する基礎的なGISデータを無償提供。",
      officialUrl: "https://nlftp.mlit.go.jp/ksj/",
      documentationUrl: "https://nlftp.mlit.go.jp/ksj/other/agreement.html",
      category: "gis",
      dataFormat: "GeoJSON",
      accessType: "download",
      requiresApiKey: false,
      licenseName: "国土数値情報ダウンロードサービス利用約款",
      commercialUse: "allowed",
      attributionRequired: true,
      updateFrequency: "yearly",
      trustLevel: 5,
      qualityScore: 90,
      tags: ["災害", "都市計画", "地形", "交通"],
      useCases: [
        {
          useCaseName: "工事候補地の災害リスク確認",
          targetSystem: "Site Risk Checker",
          description: "土砂災害警戒区域・浸水想定区域データの活用",
        },
      ],
    },
    {
      providerId: mlit.id,
      name: "PLATEAU",
      nameEn: "Project PLATEAU",
      description:
        "国土交通省主導の3D都市モデル整備・活用・オープンデータ化プロジェクト。CityGML形式の都市モデルを提供。",
      officialUrl: "https://www.mlit.go.jp/plateau/",
      endpointUrl: "https://www.geospatial.jp/ckan/dataset/plateau",
      category: "3d-city",
      dataFormat: "CityGML",
      accessType: "download",
      requiresApiKey: false,
      licenseName: "PLATEAU Sites 利用規約 (CC BY 4.0 相当)",
      commercialUse: "allowed",
      attributionRequired: true,
      updateFrequency: "yearly",
      trustLevel: 5,
      qualityScore: 85,
      tags: ["3D都市", "都市計画"],
      useCases: [
        {
          useCaseName: "都市デジタルツイン構築",
          description: "建物・都市構造の3D可視化",
        },
      ],
    },
    {
      providerId: mlit.id,
      name: "xROAD 道路データプラットフォーム",
      nameEn: "xROAD",
      description:
        "国土交通省道路局の道路データ利活用DX施策。道路基盤地図情報、交通量データ等の公開を推進。",
      officialUrl: "https://www.xroad.mlit.go.jp/",
      category: "road",
      dataFormat: "other",
      accessType: "web",
      requiresApiKey: false,
      commercialUse: "unknown",
      attributionRequired: true,
      updateFrequency: "irregular",
      trustLevel: 4,
      qualityScore: 70,
      note: "データセットごとに利用条件が異なるため個別確認が必要",
      tags: ["道路", "交通", "維持管理", "利用条件要確認"],
      useCases: [
        {
          useCaseName: "建設物流ルート検討",
          targetSystem: "Logistics Route Planner",
        },
      ],
    },
    {
      providerId: mlit.id,
      name: "道路構造物管理情報",
      nameEn: "Road Structures DB",
      description:
        "全国の橋梁・トンネル等の道路構造物の諸元・点検情報を公開する国土交通省のデータベース。",
      officialUrl: "https://road-structures-db.mlit.go.jp/",
      category: "road",
      dataFormat: "HTML",
      accessType: "web",
      requiresApiKey: false,
      commercialUse: "unknown",
      attributionRequired: true,
      updateFrequency: "irregular",
      trustLevel: 4,
      qualityScore: 65,
      tags: ["道路", "維持管理", "利用条件要確認"],
      useCases: [
        {
          useCaseName: "インフラ維持管理マップ",
          targetSystem: "Infrastructure Maintenance Map",
        },
      ],
    },
    {
      providerId: jartic.id,
      name: "JARTIC 交通量API",
      nameEn: "JARTIC Traffic Volume API",
      description:
        "常時観測交通量データ等を提供するAPI。xROAD施策と連携した道路交通データ源。",
      officialUrl: "https://www.jartic.or.jp/",
      endpointUrl: "https://api.jartic-open-traffic.org/geoserver",
      category: "road",
      dataFormat: "JSON",
      accessType: "API",
      requiresApiKey: false,
      commercialUse: "restricted",
      attributionRequired: true,
      updateFrequency: "hourly",
      trustLevel: 4,
      qualityScore: 70,
      tags: ["交通", "道路", "利用条件要確認"],
      useCases: [
        {
          useCaseName: "工事車両の交通量影響確認",
          description: "施工計画時の周辺交通量把握",
        },
      ],
    },
    {
      providerId: gsi.id,
      name: "地理院タイル",
      nameEn: "GSI Tiles",
      description:
        "標準地図、写真、標高タイルなどをXYZ形式で提供する国土地理院の地図タイルサービス。",
      officialUrl: "https://maps.gsi.go.jp/development/ichiran.html",
      endpointUrl: "https://cyberjapandata.gsi.go.jp/xyz/std/5/28/12.png",
      documentationUrl: "https://maps.gsi.go.jp/development/siyou.html",
      category: "map-elevation",
      dataFormat: "PNG",
      accessType: "tile",
      requiresApiKey: false,
      licenseName: "国土地理院コンテンツ利用規約",
      commercialUse: "allowed",
      attributionRequired: true,
      updateFrequency: "irregular",
      trustLevel: 5,
      qualityScore: 90,
      tags: ["地形", "道路"],
      useCases: [
        { useCaseName: "現場周辺の地図表示", description: "背景地図としての利用" },
      ],
    },
    {
      providerId: gsi.id,
      name: "国土地理院 標高API",
      nameEn: "GSI Elevation API",
      description:
        "指定した緯度経度の標高値をJSONで返すAPI。地形・災害リスク分析の基礎データとして利用可能。",
      officialUrl: "https://maps.gsi.go.jp/development/elevation_s.html",
      endpointUrl:
        "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=140.08531&lat=36.103543&outtype=JSON",
      category: "map-elevation",
      dataFormat: "JSON",
      accessType: "API",
      requiresApiKey: false,
      licenseName: "国土地理院コンテンツ利用規約",
      commercialUse: "allowed",
      attributionRequired: true,
      updateFrequency: "irregular",
      trustLevel: 5,
      qualityScore: 90,
      tags: ["標高", "地形", "工事候補地"],
      useCases: [
        {
          useCaseName: "工事候補地の標高・地形確認",
          targetSystem: "Site Risk Checker",
        },
      ],
    },
    {
      providerId: jma.id,
      name: "気象庁 防災情報XML",
      nameEn: "JMA Disaster Prevention Information XML",
      description:
        "気象警報・地震・津波等の防災情報をXML形式でPULL型提供。Atomフィードから電文を取得できる。",
      officialUrl: "https://xml.kishou.go.jp/",
      endpointUrl: "https://www.data.jma.go.jp/developer/xml/feed/regular.xml",
      documentationUrl: "https://xml.kishou.go.jp/xmlpull.html",
      category: "weather",
      dataFormat: "XML",
      accessType: "API",
      requiresApiKey: false,
      licenseName: "気象庁ホームページ利用規約 (CC BY 4.0 互換)",
      commercialUse: "allowed",
      attributionRequired: true,
      updateFrequency: "realtime",
      trustLevel: 5,
      qualityScore: 85,
      tags: ["気象", "災害", "施工判断"],
      useCases: [
        {
          useCaseName: "気象・河川による施工判断支援",
          targetSystem: "Weather & Water Decision",
        },
      ],
    },
    {
      providerId: soumu.id,
      name: "e-Stat API",
      nameEn: "e-Stat API",
      description:
        "政府統計の総合窓口。人口、地域統計、産業統計等をREST APIで機械判読可能な形式で提供。APIキー(appId)が必要。",
      officialUrl: "https://www.e-stat.go.jp/api/",
      endpointUrl: "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList",
      documentationUrl: "https://www.e-stat.go.jp/api/api-info/e-stat-manual",
      category: "statistics",
      dataFormat: "JSON",
      accessType: "API",
      requiresApiKey: true,
      apiKeyEnvName: "ESTAT_APP_ID",
      licenseName: "e-Stat 利用規約",
      commercialUse: "allowed",
      attributionRequired: true,
      updateFrequency: "monthly",
      trustLevel: 5,
      qualityScore: 85,
      tags: ["統計", "APIキー必要"],
      useCases: [
        {
          useCaseName: "地域人口・産業統計の把握",
          description: "工事エリアの地域特性分析",
        },
      ],
    },
    {
      providerId: osmf.id,
      name: "OpenStreetMap (Overpass API)",
      nameEn: "OpenStreetMap",
      description:
        "コミュニティによる自由な地図データ。道路、施設、POI等をOverpass APIで取得可能。ODbLライセンス。",
      officialUrl: "https://www.openstreetmap.org/",
      endpointUrl: "https://overpass-api.de/api/status",
      documentationUrl: "https://wiki.openstreetmap.org/wiki/Overpass_API",
      category: "map",
      dataFormat: "JSON",
      accessType: "API",
      requiresApiKey: false,
      licenseName: "ODbL 1.0",
      commercialUse: "allowed",
      attributionRequired: true,
      updateFrequency: "realtime",
      trustLevel: 4,
      qualityScore: 75,
      note: "再配布時はODbLの条件(出典表記・同一ライセンス)に従うこと",
      tags: ["道路", "地形"],
      useCases: [
        { useCaseName: "現場周辺施設の確認", description: "POI・道路網の参照" },
      ],
    },
  ];

  for (const s of sources) {
    const { tags, useCases, ...data } = s;
    const existing = await prisma.dataSource.findFirst({
      where: { name: data.name },
    });
    const source = existing
      ? await prisma.dataSource.update({ where: { id: existing.id }, data })
      : await prisma.dataSource.create({ data });

    for (const tagName of tags) {
      const tagId = tagMap.get(tagName);
      if (!tagId) continue;
      await prisma.dataSourceTag.upsert({
        where: {
          dataSourceId_tagId: { dataSourceId: source.id, tagId },
        },
        update: {},
        create: { dataSourceId: source.id, tagId },
      });
    }

    for (const uc of useCases) {
      const found = await prisma.relatedUseCase.findFirst({
        where: { dataSourceId: source.id, useCaseName: uc.useCaseName },
      });
      if (!found) {
        await prisma.relatedUseCase.create({
          data: { dataSourceId: source.id, ...uc },
        });
      }
    }
  }

  const count = await prisma.dataSource.count();
  console.log(`Seed completed: ${count} data sources registered.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
