const json = (data, status = 200) => {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8"
        }
    });
};

const readPayload = async (request) => {
    try {
        return await request.json();
    } catch (_error) {
        return null;
    }
};

const safe = (value, fallback = "-") => {
    if (value === null || value === undefined) {
        return fallback;
    }
    const asString = String(value).trim();
    return asString ? asString : fallback;
};

const isEmail = (value) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
};

const verifyTurnstile = async ({ secret, token, ip }) => {
    const body = new URLSearchParams();
    body.append("secret", secret);
    body.append("response", token);
    if (ip) {
        body.append("remoteip", ip);
    }

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
    });

    if (!response.ok) {
        return { success: false, errors: ["siteverify-http-error"] };
    }

    const data = await response.json();
    return {
        success: Boolean(data.success),
        hostname: data.hostname || "",
        errors: Array.isArray(data["error-codes"]) ? data["error-codes"] : []
    };
};

const buildTextBody = ({ quote, customer, submittedAt }) => {
    return [
        "New accepted 3D print quote",
        "",
        `Submitted at: ${safe(submittedAt)}`,
        `Quote ref: ${safe(quote.quoteReference)}`,
        `File: ${safe(quote.fileName)} (${safe(quote.fileSizeMB)} MB)`,
        `Total: AUD ${Number(quote.total || 0).toFixed(2)}`,
        "",
        "Customer",
        `Name: ${safe(customer.fullName)}`,
        `Email: ${safe(customer.email)}`,
        `Phone: ${safe(customer.phone)}`,
        `Delivery: ${safe(customer.deliveryNote)}`,
        `Notes: ${safe(customer.notes)}`,
        "",
        "Quote settings",
        `Material: ${safe(quote.material)}`,
        `Quality: ${safe(quote.quality)}`,
        `Infill: ${safe(quote.infill)}%`,
        `Quantity: ${safe(quote.quantity)}`,
        `Turnaround: ${safe(quote.turnaround)}`,
        `Shipping: ${safe(quote.shipping)}`
    ].join("\n");
};

const buildHtmlBody = ({ quote, customer, submittedAt }) => {
    return `
        <h2>New accepted 3D print quote</h2>
        <p><strong>Submitted at:</strong> ${safe(submittedAt)}</p>
        <p><strong>Quote ref:</strong> ${safe(quote.quoteReference)}</p>
        <p><strong>File:</strong> ${safe(quote.fileName)} (${safe(quote.fileSizeMB)} MB)</p>
        <p><strong>Total:</strong> AUD ${Number(quote.total || 0).toFixed(2)}</p>
        <h3>Customer</h3>
        <p><strong>Name:</strong> ${safe(customer.fullName)}<br>
        <strong>Email:</strong> ${safe(customer.email)}<br>
        <strong>Phone:</strong> ${safe(customer.phone)}<br>
        <strong>Delivery:</strong> ${safe(customer.deliveryNote)}<br>
        <strong>Notes:</strong> ${safe(customer.notes)}</p>
        <h3>Quote settings</h3>
        <p><strong>Material:</strong> ${safe(quote.material)}<br>
        <strong>Quality:</strong> ${safe(quote.quality)}<br>
        <strong>Infill:</strong> ${safe(quote.infill)}%<br>
        <strong>Quantity:</strong> ${safe(quote.quantity)}<br>
        <strong>Turnaround:</strong> ${safe(quote.turnaround)}<br>
        <strong>Shipping:</strong> ${safe(quote.shipping)}</p>
    `;
};

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            "allow": "POST, OPTIONS"
        }
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const payload = await readPayload(request);

    if (!payload || typeof payload !== "object") {
        return json({ error: "Invalid JSON payload." }, 400);
    }

    const quote = payload.quote || {};
    const customer = payload.customer || {};
    const turnstileToken = safe(payload.turnstileToken, "");
    const submittedAt = payload.submittedAt || new Date().toISOString();

    if (!safe(quote.quoteReference, "") || !safe(quote.fileName, "")) {
        return json({ error: "Missing required quote fields." }, 400);
    }

    if (!safe(customer.fullName, "") || !isEmail(customer.email)) {
        return json({ error: "Valid customer name and email are required." }, 400);
    }

    const turnstileSecret = env.TURNSTILE_SECRET_KEY;
    if (!turnstileSecret) {
        return json({ error: "TURNSTILE_SECRET_KEY is missing." }, 500);
    }

    if (!turnstileToken) {
        return json({ error: "Missing Turnstile token." }, 400);
    }

    const turnstileCheck = await verifyTurnstile({
        secret: turnstileSecret,
        token: turnstileToken,
        ip: request.headers.get("CF-Connecting-IP") || ""
    });

    if (!turnstileCheck.success) {
        return json({
            error: "Turnstile verification failed.",
            codes: turnstileCheck.errors
        }, 403);
    }

    const expectedHostname = safe(env.TURNSTILE_EXPECTED_HOSTNAME, "");
    if (expectedHostname && turnstileCheck.hostname && turnstileCheck.hostname !== expectedHostname) {
        return json({
            error: "Turnstile hostname mismatch.",
            hostname: turnstileCheck.hostname
        }, 403);
    }

    const resendApiKey = env.RESEND_API_KEY;
    const quoteToEmail = env.QUOTE_TO_EMAIL;
    const quoteFromEmail = env.QUOTE_FROM_EMAIL;

    if (!resendApiKey || !quoteToEmail || !quoteFromEmail) {
        return json({
            error: "Email service is not configured. Missing RESEND_API_KEY, QUOTE_TO_EMAIL, or QUOTE_FROM_EMAIL."
        }, 500);
    }

    const subject = `Accepted Quote ${safe(quote.quoteReference)}`;
    const textBody = buildTextBody({ quote, customer, submittedAt });
    const htmlBody = buildHtmlBody({ quote, customer, submittedAt });

    const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: quoteFromEmail,
            to: [quoteToEmail],
            reply_to: customer.email,
            subject,
            text: textBody,
            html: htmlBody
        })
    });

    if (!resendResponse.ok) {
        const details = await resendResponse.text();
        return json({ error: "Failed to send email.", details }, 502);
    }

    return json({ ok: true, message: "Quote submitted successfully." }, 200);
}
