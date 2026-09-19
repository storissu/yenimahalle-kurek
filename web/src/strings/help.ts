// Turkish help texts shown in the app (Profil → Yardım for members, Diğer → Yardım for coaches).
// The same answers are in docs/tr/UYE-REHBERI.md and docs/tr/ANTRENOR-REHBERI.md — keep them in step.
// Text uses backtick strings so Turkish apostrophes need no escaping.

export interface HelpItem {
  q: string;
  a: string;
}

export const help = {
  title: `Yardım`,
  memberIntro: `Sık sorulan sorular. Cevabı burada bulamazsanız antrenörünüze sorun.`,
  coachIntro: `Antrenör olarak sık yapılan işler. Cevabı burada bulamazsanız kurulumu yapan kişiye sorun.`,
  link: `Yardım ve sık sorulan sorular`,
  feedbackTitle: `Görüş veya sorun bildirin`,
  feedbackBody: `Bir şey çalışmıyorsa ya da bir öneriniz varsa yazın; hangi telefonu kullandığınızı ve ne yaptığınızı belirtmeniz işimizi kolaylaştırır.`,
  feedbackAction: `Görüş bildir`,
  feedbackNone: `Görüşlerinizi antrenörünüze iletin.`,
  member: [
    {
      q: `Uygulamayı telefonuma nasıl yüklerim?`,
      a: `Mağazadan indirmeniz gerekmez. iPhone'da Safari ile siteyi açın, Paylaş düğmesine dokunup "Ana Ekrana Ekle"yi seçin. Android'de Chrome'da ⋮ menüsünden "Uygulamayı yükle"yi seçin. Sonra ana ekrandaki "Kürek" simgesinden açın. Adım adım anlatım için Profil sayfasındaki yükleme kutusuna bakın.`,
    },
    {
      q: `İlk kez nasıl giriş yaparım?`,
      a: `Antrenörünüz size bir kullanıcı adı ve geçici şifre verir. Bunlarla giriş yaptığınızda kendi şifrenizi belirlemeniz istenir (en az 8 karakter; harf ve rakam içermeli).`,
    },
    {
      q: `Şifremi unuttum.`,
      a: `Antrenörünüze söyleyin; size yeni bir geçici şifre verir. İlk girişte yine yeni şifre belirlersiniz.`,
    },
    {
      q: `Antrenmana katılacağımı nasıl bildiririm?`,
      a: `Ana Sayfa'da veya Antrenmanlar'da ilgili antrenmanı açın ve "Katılıyorum" ya da "Katılmıyorum"a dokunun. "Katılıyorum", o gün hangi saate yazılırsanız yazılın orada olacağınız anlamına gelir. Özel isteğinizi (ör. "9'dan sonraya yazın") not olarak ekleyebilirsiniz.`,
    },
    {
      q: `Yanıtımı neden değiştiremiyorum?`,
      a: `Yanıt; son yanıt zamanı geçince veya antrenör programı yayınlayınca kilitlenir. Değişiklik gerekiyorsa antrenörünüzle görüşün, sizin yerinize güncelleyebilir.`,
    },
    {
      q: `Hangi tekneye, hangi saate yazıldığımı nerede görürüm?`,
      a: `Program yayınlanınca Ana Sayfa'nın üstünde "Sizin programınız" kutusunda tekneniz, saatiniz, ekip arkadaşlarınız ve o saatin hava tahmini görünür. Altında tüm program tekne tekne listelenir; sizin seanslarınız dolu mavi bir kutuyla ve "Siz" etiketiyle öne çıkar, kürek çektiğiniz tekneler en üstte "Sizin tekneniz" etiketiyle gelir. Teknelerin yanındaki küçük çizim kaç kişilik olduğunu gösterir.`,
    },
    {
      q: `Ekip arkadaşımın telefonuna nasıl ulaşırım?`,
      a: `Programda arkadaşınızın adına dokunun; telefon numarası açılır ve tek dokunuşla arayabilirsiniz. Tüm üyeleri Profil → Kulüp üyeleri sayfasında da görebilirsiniz. Numaralar yalnızca kulüp üyelerine görünür.`,
    },
    {
      q: `Bir üyeyle birlikte ne zaman kürek çektik?`,
      a: `Profil → Kulüp üyeleri'nde (ya da sıralamada, ya da programda bir ismin kartında "Profili aç") üyenin adına dokunun. Telefonu ve sizinle aynı teknede kürek çektiğiniz seanslar görünür. Yalnızca ikinizin de o seansta olduğu ve yoklamada "Geldi" işaretlendiği seanslar sayılır; farklı teknelerde çektiyseniz görünmez.`,
    },
    {
      q: `Bildirim almıyorum.`,
      a: `Profil → "Bildirimleri aç"a dokunup izin verin. iPhone'da bildirim için uygulamanın ana ekrandan açılması ve iOS 16.4 veya üstü gerekir. Android'de pil tasarrufu uygulamayı kısıtlıyorsa Kürek için kısıtlamayı kapatın. Bildirimleri kaçırsanız da hepsi sağ üstteki zil simgesinde durur.`,
    },
    {
      q: `Sıralama nasıl hesaplanıyor?`,
      a: `Tamamlanmış antrenmanlarda kürek çektiğiniz her saat 1 seans sayılır (2 saat çektiyseniz 2). Sıralama her takvim ayının başında sıfırlanır; geçmiş aylara ay seçicisinden bakabilirsiniz. Eşit seansı olanlar aynı sırayı paylaşır. Bu ay hiç seansı olmayan üyeler de listenin en altında "–" ve 0 seansla yer alır.`,
    },
    {
      q: `Hava durumu tahmini ne kadar güvenilir?`,
      a: `Tahmin Open-Meteo'dan gelir; dalga değerleri açık deniz modelinden alındığı için kıyıda yaklaşık olabilir. Antrenmanın yapılıp yapılmayacağına her zaman antrenör karar verir.`,
    },
    {
      q: `Kişisel verilerim ne olur?`,
      a: `Ad soyad, kullanıcı adı, isteğe bağlı telefon numarası, yanıtlar ve yoklamalarınız tutulur. Telefon numaranız kulüp üyelerine görünür. Ayrıntılar için Profil → Gizlilik bildirimi.`,
    },
  ] satisfies HelpItem[],
  coach: [
    {
      q: `Antrenmanı nasıl oluştururum?`,
      a: `Antrenmanlar → "Antrenman ekle". Tarih, başlangıç saati ve son yanıt zamanını seçin (12/24/48 saat önce, bir önceki akşam 20:00 veya özel). Kaç seans süreceğini şimdi girmeniz gerekmez; programı hazırlarken "Seans ekle" ile eklersiniz.`,
    },
    {
      q: `Programı nasıl hazırlar ve yayınlarım?`,
      a: `Antrenmanı açıp Program sekmesine gidin. Her seans için bir sekme vardır; tekneye "Ekip seç" ile üyeleri ekleyin, aynı tekneye sonraki seansta başka ekip yazabilirsiniz. "Önceki seansı kopyala" işi hızlandırır. "Taslağı kaydet" üyelere görünmez; "Yayınla" herkese gösterir ve bildirim gönderir. C4X tam 4 kişi olmadan yayınlanamaz.`,
    },
    {
      q: `Yayınladıktan sonra değişiklik yapabilir miyim?`,
      a: `Evet: düzenleyip "Güncelle"ye basın. Yalnızca ekibi değişenlere bildirim gider; "Üyelere bildirim gönder" işaretini kaldırırsanız sessizce düzeltirsiniz. Program yayınlandığı anda üyelerin yanıtları kilitlenir; "Yayından kaldır" derseniz yanıtlar (süre dolmadıysa) yeniden açılır.`,
    },
    {
      q: `Bir üyenin yerine yanıt girebilir miyim?`,
      a: `Evet. Antrenmanın Yanıtlar sekmesinde üyenin satırına dokunun. Son yanıt zamanı geçmiş veya program yayınlanmış olsa da çalışır; "Antrenör girdi" etiketiyle görünür.`,
    },
    {
      q: `Yoklamayı nasıl alırım?`,
      a: `Antrenman başlayınca Yoklama sekmesi açılır. Liste programdaki ekiplerden hazır gelir; gelmeyenleri "Gelmedi" yapın, programda olmayıp kürek çekenleri "Kişi ekle" ile ekleyin. Antrenman planlanandan uzun sürdüyse "Seans ekle". "Kaydet" ilerlemeyi saklar, "Yoklamayı tamamla" istatistiklere işler (sonradan düzeltebilirsiniz).`,
    },
    {
      q: `Üye ekleme, şifre sıfırlama, hesabı kapatma`,
      a: `Üyeler sayfasından. "Üye ekle" bir kullanıcı adı ve tek seferlik şifre üretir; "Davet mesajını kopyala" ile WhatsApp'tan gönderin. Şifre yalnızca bir kez gösterilir. Üyeye dokunup şifreyi sıfırlayabilir veya hesabı devre dışı bırakabilirsiniz (geçmişi korunur). Telefon numarası eklemek isteğe bağlıdır ve diğer üyelere görünür.`,
    },
    {
      q: `Hava uyarısı eşiklerini nasıl ayarlarım?`,
      a: `Diğer → Kulüp ayarları. Rüzgâr hamlesi ve dalga eşiği koyarsanız, tahmin bu değerleri aştığında yalnızca antrenörlere uyarı görünür. Uygulama hiçbir antrenmanı kendiliğinden iptal etmez.`,
    },
    {
      q: `Antrenmanı iptal etmek`,
      a: `Antrenman sayfasında "İptal et" → neden yazın (3–200 karakter). Tüm üyelere bildirim gider ve iptal geri alınamaz.`,
    },
    {
      q: `Kim neyi değiştirdi?`,
      a: `Diğer → Değişiklik geçmişi. Antrenman, program, yoklama, üye ve ayar değişiklikleri kim/ne zaman ile listelenir (bir yıl saklanır). Şifreler ve telefon numaraları kaydedilmez.`,
    },
    {
      q: `Verilerin yedeği var mı?`,
      a: `Her hafta otomatik şifreli yedek alınır (kurulumu yapan kişi kontrol eder). Ek olarak ay sonunda İstatistik → "Özet (CSV)" ve "Ayrıntılı (CSV)" ile Excel'e aktarabilirsiniz.`,
    },
  ] satisfies HelpItem[],
} as const;
