# מדריך העלאה לאוויר (פרודקשן)

המטרה: שהבוט והאתר ירוצו בענן 24/7 עם כתובת קבועה — גם כשהמחשב שלך כבוי.

**התמונה הכללית:** הקוד עולה ל‑**GitHub** → מסד נתונים ב‑**Neon** (חינם) → השרת רץ ב‑**Render** (חינם) → מכוונים את **Twilio** לכתובת החדשה.

כל השירותים בחינם. צריך לפתוח 3 חשבונות (GitHub, Neon, Render) — אם עוד אין לך.

---

## שלב 1 — העלאת הקוד ל‑GitHub

1. פתח חשבון ב‑https://github.com (אם אין) וצור **repository חדש וריק** (למשל בשם `torbot`). אל תסמן "Add README".
2. במחשב, בתיקיית הפרויקט (`whatsapp booking`), הרץ בטרמינל:

```bash
git init
git add .
git commit -m "TorBot booking system"
git branch -M main
git remote add origin https://github.com/<שם-המשתמש-שלך>/torbot.git
git push -u origin main
```

> אם git מבקש שם/אימייל בפעם הראשונה:
> ```bash
> git config --global user.name "Your Name"
> git config --global user.email "you@example.com"
> ```

הקובץ `.gitignore` כבר דואג ש**הסודות** (`.env`) ו‑`node_modules` **לא** יעלו.

---

## שלב 2 — מסד נתונים ב‑Neon

1. פתח חשבון ב‑https://neon.tech (חינם).
2. צור **Project** חדש.
3. העתק את ה‑**Connection String** (נראה כמו `postgresql://user:pass@...neon.tech/dbname?sslmode=require`). שמור אותו לצד — נצטרך אותו בשלב הבא.

הטבלאות ייווצרו אוטומטית בהפעלה הראשונה של השרת.

---

## שלב 3 — פריסה ב‑Render

1. פתח חשבון ב‑https://render.com (חינם) והתחבר עם GitHub.
2. לחץ **New → Blueprint**, ובחר את ה‑repo `torbot`. Render יזהה אוטומטית את הקובץ `render.yaml`.
3. Render יבקש למלא את המשתנים הסודיים. מלא:
   - `DATABASE_URL` — ה‑Connection String מ‑Neon (שלב 2)
   - `GROQ_API_KEY` — מפתח Groq שלך
   - `TWILIO_ACCOUNT_SID` ו‑`TWILIO_AUTH_TOKEN` — מפרטי Twilio
   - `SANDBOX_BUSINESS_PHONE` — מספר העסק שלך, למשל `+972504732111`
   - `PUBLIC_WEBHOOK_URL` — אפשר להשאיר ריק בינתיים; נמלא אחרי הפריסה
4. לחץ **Apply / Deploy** והמתן שהבנייה תסתיים (כמה דקות).
5. תקבל כתובת קבועה, למשל `https://torbot.onrender.com`. פתח אותה — האתר אמור לעלות.

---

## שלב 4 — לחבר את Twilio לכתובת החדשה

1. ב‑Twilio → WhatsApp Sandbox → **Sandbox settings**, בשדה **"When a message comes in"** הדבק:
   `https://<הכתובת-שלך>.onrender.com/webhook` (Method: POST), ולחץ Save.
2. (מומלץ, לאבטחה) חזור ל‑Render → Environment, קבע:
   - `PUBLIC_WEBHOOK_URL` = `https://<הכתובת-שלך>.onrender.com/webhook`
   - `VALIDATE_TWILIO` = `true`
   ושמור (זה יגרום לפריסה מחדש).

זהו! עכשיו הבוט רץ בענן. שלח לו הודעה בוואטסאפ — הוא יענה גם כשהמחשב שלך כבוי. 🎉

---

## דברים שכדאי לדעת

- **התוכנית החינמית של Render "נרדמת"** אחרי 15 דקות ללא פעילות, וההודעה הראשונה אחרי שינה עלולה להתעכב ~30 שניות. פתרונות: לשדרג ל‑$7/חודש (always‑on), או ping אוטומטי כל 10 דקות.
- **וואטסאפ לפרודקשן אמיתי:** ה‑Sandbox עדיין דורש שהלקוחות "יצטרפו". ללקוחות אמיתיים צריך **WhatsApp Sender מאושר** מ‑Twilio (אימות עסק מול Meta).
- **החלף מפתחות:** ה‑Groq/Twilio שהשתמשנו בהם בפיתוח — כדאי לייצר חדשים לפרודקשן.
- **עדכונים:** כל `git push` ל‑`main` יפרוס אוטומטית גרסה חדשה ב‑Render.
