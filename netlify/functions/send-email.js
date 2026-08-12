const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY_KATYA);

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const data = JSON.parse(event.body);
        
        const response = await resend.emails.send({
            from: 'Екатерина Донна <hello@ekaterina-donnat.com>',
            // Домен без MX: ответ на hello@ отскакивает
            replyTo: 'ekaterina.donnat@gmail.com',
            to: data.email,
            subject: data.subject || 'Твоя практика готова',
            html: data.htmlBody || '<p>Ссылка на твою практику внутри.</p>'
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, id: response.id })
        };
        
    } catch (error) {
        console.error('Ошибка Ресенда:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Не удалось отправить письмо' })
        };
    }
};
