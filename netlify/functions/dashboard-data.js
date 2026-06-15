// netlify/functions/dashboard-data.js
// Читает все аналитические данные из Supabase для дашборда
// GET /.netlify/functions/dashboard-data

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

        // 1. Покупки за 30 дней
        const { data: purchases } = await supabase
            .from('purchases')
            .select('email, track_ids, utm_source, product_name, created_at')
            .gte('created_at', thirtyDaysAgo)
            .order('created_at', { ascending: false });

        // 2. Гости (лиды через форму) за 30 дней
        const { data: guests } = await supabase
            .from('donna_guests')
            .select('email, utm_source, created_at')
            .gte('created_at', thirtyDaysAgo)
            .order('created_at', { ascending: false });

        // 3. Общее количество гостей (вся база)
        const { count: totalGuests } = await supabase
            .from('donna_guests')
            .select('*', { count: 'exact', head: true });

        // 4. Прогресс прослушивания
        const { data: progress } = await supabase
            .from('listening_progress')
            .select('token, seconds');

        // 5. События демо-плеера за 30 дней
        const { data: demoEvents } = await supabase
            .from('demo_events')
            .select('event, source, created_at')
            .gte('created_at', thirtyDaysAgo);

        // Считаем события демо по типу и источнику
        const demo = {
            pageviews: { total: 0, paid: 0, referral: 0, pinterest: 0, organic: 0 },
            plays:     { total: 0, paid: 0, referral: 0, pinterest: 0, organic: 0 },
            leads:     { total: 0, paid: 0, referral: 0, pinterest: 0, organic: 0 },
        };

        if (demoEvents) {
            demoEvents.forEach(e => {
                const bucket = e.event === 'pageview' ? demo.pageviews
                             : e.event === 'play' ? demo.plays
                             : e.event === 'lead' ? demo.leads : null;
                if (!bucket) return;
                bucket.total++;
                if (e.source === 'paid') bucket.paid++;
                else if (e.source === 'referral') bucket.referral++;
                else if (e.source === 'pinterest') bucket.pinterest++;
                else bucket.organic++;
            });
        }

        // Считаем метрики
        const purchaseCount = purchases?.length || 0;
        const guestCount = guests?.length || 0;

        // Выручка - маппинг продуктов к ценам
        const PRICES = {
            'step1': 150,
            'checkup': 25,
            'combo': 55,
            'step1_deep': 310,
            'step1_cycle': 650,
            'album': 350,
        };

        let totalRevenue = 0;
        const salesList = [];

        if (purchases) {
            purchases.forEach(p => {
                // Определяем цену по track_ids или product_name
                let price = 150; // дефолт - ступень 1
                const name = (p.product_name || '').toLowerCase();
                if (name.includes('checkup') || name.includes('чек-ап')) price = 25;
                else if (name.includes('combo') || name.includes('комбо')) price = 55;
                else if (name.includes('deep') || name.includes('разбор')) price = 310;
                else if (name.includes('cycle') || name.includes('цикл')) price = 650;
                else if (name.includes('album') || name.includes('альбом')) price = 350;

                totalRevenue += price;
                salesList.push({
                    product: p.product_name || 'Ступень 1',
                    amount: price,
                    source: p.utm_source || 'direct',
                    date: p.created_at,
                });
            });
        }

        // Средний чек
        const avgCheck = purchaseCount > 0 ? Math.round(totalRevenue / purchaseCount) : 0;

        // Источники трафика - гости
        const sourceGuests = { instagram: 0, referral: 0, pinterest: 0, organic: 0 };
        if (guests) {
            guests.forEach(g => {
                const src = g.utm_source || 'organic';
                if (src.includes('instagram') || src.includes('facebook')) sourceGuests.instagram++;
                else if (src.includes('referral') || src.includes('invite')) sourceGuests.referral++;
                else if (src.includes('pinterest')) sourceGuests.pinterest++;
                else sourceGuests.organic++;
            });
        }

        // Источники трафика - покупки
        const sourcePurchases = { instagram: 0, referral: 0, pinterest: 0, organic: 0 };
        if (purchases) {
            purchases.forEach(p => {
                const src = p.utm_source || 'direct';
                if (src.includes('instagram') || src.includes('facebook')) sourcePurchases.instagram++;
                else if (src.includes('referral') || src.includes('invite')) sourcePurchases.referral++;
                else if (src.includes('pinterest')) sourcePurchases.pinterest++;
                else sourcePurchases.organic++;
            });
        }

        // Общие часы прослушивания
        let totalSeconds = 0;
        if (progress) {
            progress.forEach(p => { totalSeconds += p.seconds || 0; });
        }
        const totalHours = Math.round(totalSeconds / 3600 * 10) / 10;

        // Доля реферального трафика
        const totalGuestCount = guestCount || 1;
        const referralPercent = Math.round((sourceGuests.referral / totalGuestCount) * 100);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                period: '30d',
                updated: now.toISOString(),

                // Воронка
                funnel: {
                    leads: guestCount,
                    purchases: purchaseCount,
                    hours: totalHours,
                },

                // Ключевые метрики
                revenue: totalRevenue,
                avgCheck: avgCheck,
                emailBase: totalGuests || 0,
                referralPercent: referralPercent,

                // Источники - гости
                sourceGuests: sourceGuests,

                // Источники - покупки
                sourcePurchases: sourcePurchases,

                // Последние продажи
                sales: salesList.slice(0, 10),

                // События демо-плеера
                demo: demo,
            }),
        };

    } catch (err) {
        console.error('Dashboard data error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server error' }),
        };
    }
};
