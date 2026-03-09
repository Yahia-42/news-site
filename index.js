const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===================================================
// إعدادات الفئات — روابط Google News RSS
// ===================================================
const CATEGORIES = {
  top: {
    name: 'أبرز الأخبار',
    icon: '🔥',
    url: 'https://news.google.com/rss?hl=ar&gl=EG&ceid=EG:ar'
  },
  world: {
    name: 'أخبار العالم',
    icon: '🌍',
    url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtRnlHZ0pCUlNnQVAB?hl=ar&gl=EG&ceid=EG:ar'
  },
  technology: {
    name: 'التكنولوجيا',
    icon: '💻',
    url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtRnlHZ0pCUlNnQVAB?hl=ar&gl=EG&ceid=EG:ar'
  },
  business: {
    name: 'الاقتصاد',
    icon: '📈',
    url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6Y1dZU0FtRnlHZ0pCUlNnQVAB?hl=ar&gl=EG&ceid=EG:ar'
  },
  sports: {
    name: 'الرياضة',
    icon: '⚽',
    url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtRnlHZ0pCUlNnQVAB?hl=ar&gl=EG&ceid=EG:ar'
  },
  health: {
    name: 'الصحة',
    icon: '🏥',
    url: 'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtRnlLQUFQAQ?hl=ar&gl=EG&ceid=EG:ar'
  },
  science: {
    name: 'العلوم',
    icon: '🔬',
    url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtRnlHZ0pCUlNnQVAB?hl=ar&gl=EG&ceid=EG:ar'
  },
  entertainment: {
    name: 'الترفيه',
    icon: '🎬',
    url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtRnlHZ0pCUlNnQVAB?hl=ar&gl=EG&ceid=EG:ar'
  }
};

// ===================================================
// إعدادات Telegram
// ===================================================
const TELEGRAM_TOKEN = '8753548382:AAHcJOnufSgexaaacfLCRUuPbolFUzsKF2A';
const TELEGRAM_CHANNEL = '-1002075671376';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// حفظ الأخبار المنشورة عشان منكررش
const publishedLinks = new Set();

async function sendToTelegram(article) {
  try {
    const msg = `${article.categoryIcon} *${escapeMarkdown(article.categoryName)}*\n\n` +
      `*${escapeMarkdown(article.title)}*\n\n` +
      (article.description ? `${escapeMarkdown(article.description)}\n\n` : '') +
      `📰 المصدر: ${escapeMarkdown(article.source)}\n` +
      `🔗 [اقرأ الخبر كاملاً](${article.link})`;

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: TELEGRAM_CHANNEL,
      text: msg,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: false
    });

    publishedLinks.add(article.link);
    console.log(`📤 تم نشر على Telegram: ${article.title.substring(0, 50)}...`);
  } catch (err) {
    console.error('❌ خطأ في النشر على Telegram:', err.response?.data?.description || err.message);
  }
}

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

async function publishNewArticles(articles) {
  // انشر بس الأخبار الجديدة اللي مش اتنشرت قبل كده
  const newArticles = articles.filter(a => a.link && !publishedLinks.has(a.link));
  
  if (newArticles.length === 0) {
    console.log('📭 مفيش أخبار جديدة للنشر على Telegram');
    return;
  }

  console.log(`📤 جاري نشر ${newArticles.length} خبر جديد على Telegram...`);
  
  // انشر أول 5 أخبار جديدة بس في كل مرة عشان منزهقش الناس
  const toPublish = newArticles.slice(0, 5);
  
  for (const article of toPublish) {
    await sendToTelegram(article);
    // استنى ثانيتين بين كل خبر
    await new Promise(r => setTimeout(r, 2000));
  }
}

// ===================================================
// كاش الأخبار في الذاكرة
// ===================================================
const newsCache = {};
const cacheTimestamps = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 دقائق

// ===================================================
// جلب وتحليل RSS من Google News
// ===================================================
async function fetchGoogleNews(category) {
  const catData = CATEGORIES[category];
  if (!catData) throw new Error('فئة غير موجودة');

  console.log(`📡 جاري جلب أخبار [${catData.name}] ...`);

  const response = await axios.get(catData.url, {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
      'Accept': 'application/rss+xml, application/xml, text/xml'
    }
  });

  // تحليل XML
  const parser = new xml2js.Parser({ explicitArray: false, trim: true });
  const result = await parser.parseStringPromise(response.data);

  const items = result?.rss?.channel?.item || [];
  const itemsArray = Array.isArray(items) ? items : [items];

  const articles = itemsArray.map((item, idx) => {
    // استخرج المصدر
    let source = '';
    if (item['source']) {
      source = typeof item['source'] === 'string'
        ? item['source']
        : item['source']._ || item['source']['$']?.url || '';
    }

    // نظّف الوصف من HTML
    let description = item.description || '';
    description = description.replace(/<[^>]*>/g, '').trim();
    // اختصر الوصف
    if (description.length > 200) description = description.substring(0, 200) + '...';

    return {
      id: idx + 1,
      title: item.title || '',
      link: item.link || item.guid?._ || item.guid || '',
      description,
      source: source || 'Google News',
      pubDate: item.pubDate || '',
      category: category,
      categoryName: catData.name,
      categoryIcon: catData.icon
    };
  });

  console.log(`✅ تم جلب ${articles.length} خبر من [${catData.name}]`);
  return articles;
}

// ===================================================
// API: جلب أخبار فئة معينة
// ===================================================
app.get('/api/news/:category', async (req, res) => {
  const { category } = req.params;

  if (!CATEGORIES[category]) {
    return res.status(404).json({ error: 'فئة غير موجودة', available: Object.keys(CATEGORIES) });
  }

  // تحقق من الكاش
  const now = Date.now();
  if (newsCache[category] && (now - cacheTimestamps[category]) < CACHE_DURATION) {
    console.log(`💾 إرجاع كاش [${category}]`);
    return res.json({
      success: true,
      cached: true,
      lastUpdated: new Date(cacheTimestamps[category]).toISOString(),
      count: newsCache[category].length,
      articles: newsCache[category]
    });
  }

  try {
    const articles = await fetchGoogleNews(category);
    newsCache[category] = articles;
    cacheTimestamps[category] = now;

    res.json({
      success: true,
      cached: false,
      lastUpdated: new Date().toISOString(),
      count: articles.length,
      articles
    });
  } catch (err) {
    console.error(`❌ خطأ في جلب [${category}]:`, err.message);

    // إذا في كاش قديم، ارجعه
    if (newsCache[category]) {
      return res.json({
        success: true,
        cached: true,
        stale: true,
        lastUpdated: new Date(cacheTimestamps[category]).toISOString(),
        count: newsCache[category].length,
        articles: newsCache[category]
      });
    }

    res.status(500).json({ error: 'فشل في جلب الأخبار', details: err.message });
  }
});

// ===================================================
// API: جلب كل الفئات دفعة واحدة
// ===================================================
app.get('/api/news', async (req, res) => {
  res.json({
    success: true,
    categories: Object.entries(CATEGORIES).map(([key, val]) => ({
      id: key,
      name: val.name,
      icon: val.icon,
      endpoint: `/api/news/${key}`
    }))
  });
});

// ===================================================
// API: حالة السيرفر
// ===================================================
app.get('/api/status', (req, res) => {
  const status = {};
  Object.keys(CATEGORIES).forEach(cat => {
    status[cat] = {
      cached: !!newsCache[cat],
      count: newsCache[cat]?.length || 0,
      lastUpdated: cacheTimestamps[cat] ? new Date(cacheTimestamps[cat]).toISOString() : null
    };
  });
  res.json({ success: true, uptime: process.uptime(), cache: status });
});


// ===================================================
// تحديث تلقائي كل 5 دقائق + نشر على Telegram
// ===================================================
cron.schedule("*/5 * * * *", async () => {
  console.log("🔄 تحديث تلقائي للأخبار...");
  for (const category of Object.keys(CATEGORIES)) {
    try {
      const articles = await fetchGoogleNews(category);
      newsCache[category] = articles;
      cacheTimestamps[category] = Date.now();
      if (category === "top") {
        await publishNewArticles(articles);
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`❌ فشل تحديث [${category}]:`, err.message);
    }
  }
  console.log("✅ انتهى التحديث التلقائي");
});

// ===================================================
// الصفحة الرئيسية
// ===================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===================================================
// تشغيل السيرفر + جلب مبدئي
// ===================================================
app.listen(PORT, async () => {
  console.log(`\n🚀 السيرفر شغال على: http://localhost:${PORT}`);
  console.log('📡 جاري جلب الأخبار لأول مرة...\n');

  // جلب أبرز الأخبار أولاً
  try {
    const articles = await fetchGoogleNews('top');
    newsCache['top'] = articles;
    cacheTimestamps['top'] = Date.now();
    console.log('✅ الأخبار جاهزة! افتح المتصفح على http://localhost:' + PORT);
    // نشر أول مجموعة أخبار على Telegram عند بدء التشغيل
    console.log('📤 جاري نشر الأخبار الأولى على Telegram...');
    await publishNewArticles(articles);
  } catch (err) {
    console.error('❌ خطأ في الجلب المبدئي:', err.message);
  }
});
