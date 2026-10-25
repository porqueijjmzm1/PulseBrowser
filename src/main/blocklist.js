'use strict';
// Lista interna do tuff Shield, separada por categoria. Funciona mesmo sem as listas de filtros baixadas.
//
// Formato de cada item:
//   "dominio.com"        bloqueia o domínio e todos os subdomínios (ex.: "stats.g.doubleclick.net")
//   "dominio.com/caminho" bloqueia só esse caminho (e o que vier depois dele)
//   "~dominio.com"       bloqueia só quando é carregado por outro site (o próprio site continua funcionando)
//
// Categorias com "thirdPartyOnly" tratam todos os itens como "~". Categorias com "optional" podem ser
// desligadas nas configurações; desligadas, os domínios delas também deixam de ser bloqueados pelas listas.

const CATEGORIES = [
  { id: 'ads', label: 'Anúncios', color: '#e5484d' },
  { id: 'video', label: 'Anúncios em vídeo', color: '#f76b15' },
  { id: 'trackers', label: 'Rastreadores e analytics', color: '#8e4ec6' },
  { id: 'social', label: 'Redes sociais', color: '#0090ff', optional: true, thirdPartyOnly: true,
    desc: 'Pixels, botões e SDKs do Facebook, Instagram, X, LinkedIn, TikTok, Pinterest e outros. Pode esconder o “Entrar com o Facebook” e posts incorporados.' },
  { id: 'affiliate', label: 'Afiliados e redirecionamentos', color: '#12a594', optional: true,
    desc: 'Scripts que trocam links de lojas por links de comissão (Skimlinks, Awin, CJ, Rakuten). Os links continuam abrindo.' },
  { id: 'telemetry', label: 'Telemetria de fabricantes', color: '#978365' },
  { id: 'errors', label: 'Monitoramento de erros', color: '#ad7f58', optional: true, thirdPartyOnly: true,
    desc: 'Sentry, Bugsnag, LogRocket, Datadog e similares, que gravam erros e sessões de quem visita o site.' },
  { id: 'consent', label: 'Avisos de cookies', color: '#d6409f', optional: true, thirdPartyOnly: true,
    desc: 'Esconde os banners de consentimento (OneTrust, Cookiebot, Didomi, Usercentrics…). Em alguns sites, vídeos incorporados pedem consentimento e não aparecem.' },
  { id: 'experiments', label: 'Testes A/B', color: '#3e63dd', optional: true, thirdPartyOnly: true,
    desc: 'Optimizely, VWO, AB Tasty, Dynamic Yield e outros que mudam a página para testar versões em você.' },
  { id: 'messaging', label: 'E-mail marketing, push e chat', color: '#29a383', optional: true, thirdPartyOnly: true,
    desc: 'Rastreio de e-mail marketing, pedidos de notificação e janelas de chat (Intercom, Drift, Tawk.to). O chat de suporte de alguns sites some.' },
  { id: 'malware', label: 'Mineradores e golpes', color: '#ce2c31' },
];

const RULES = {
  ads: [
    // Google
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'googletagservices.com', 'adservice.google.com',
    'pagead2.googleadservices.com', 'adsense.google.com', 'partner.googleadservices.com', 'fundingchoicesmessages.google.com',
    '~google.com/pagead', 'google.com/adsense/domains', '~www.google.com/ads', '~youtube.com/pagead', '~youtube.com/api/stats/ads',
    '~youtube.com/ptracking', 'ads.youtube.com', '~s.youtube.com', '~redirector.googlevideo.com',
    // Amazon
    'amazon-adsystem.com', 'aan.amazon.com', 'fls-na.amazon.com', 'fls-eu.amazon.com', 'fls-fe.amazon.com',
    'advertising-api-eu.amazon.com', 'advertising-api.amazon.com', 'adtago.s3.amazonaws.com', 'analyticsengine.s3.amazonaws.com',
    'advice-ads.s3.amazonaws.com', 'analytics.s3.amazonaws.com', 'amazonclix.com', 'assoc-amazon.com',
    // Microsoft / Bing
    'bat.bing.com', '~c.bing.com', 'bingads.microsoft.com', 'ads.microsoft.com', 'adnxs.com', 'adnxs-simple.com',
    'ads1.msn.com', 'rad.msn.com', 'ads.msn.com', 'adsyndication.msn.com', 'flex.msn.com', 'adserver.msn.com',
    // Yahoo / Verizon
    'ads.yahoo.com', 'gemini.yahoo.com', 'adtech.yahooinc.com', 'advertising.yahoo.com', 'partnerads.ysm.yahoo.com',
    'udc.yahoo.com', 'udcm.yahoo.com', 'log.fc.yahoo.com', 'analytics.query.yahoo.com', 'geo.yahoo.com', 'adserver.yahoo.com',
    'advertising.com', 'adtech.de', 'adtechus.com', 'yieldmo.com', 'brightroll.com',
    // Yandex e Rússia
    'an.yandex.ru', 'adfox.ru', 'adfox.yandex.ru', 'adfstat.yandex.ru', 'advertising.yandex.ru', 'offerwall.yandex.net',
    'extmaps-api.yandex.net', 'yandexadexchange.net', 'adriver.ru', 'betweendigital.com', 'begun.ru', 'ad.mail.ru',
    // Trocas, SSPs e DSPs
    'adsrvr.org', 'rubiconproject.com', 'pubmatic.com', 'openx.net', 'openx.com', 'criteo.com', 'criteo.net', 'casalemedia.com',
    'indexww.com', 'indexexchange.com', 'htlbid.com', 'media.net', 'contextweb.com', 'sovrn.com', 'lijit.com', 'gumgum.com',
    'undertone.com', 'yieldlab.net', 'bidswitch.net', 'smartadserver.com', 'sascdn.com', 'adform.net', 'adform.com', 'adition.com',
    'teads.tv', 'teads.com', 'triplelift.com', '3lift.com', '33across.com', 'sharethrough.com', 'sonobi.com', 'kargo.com',
    'smartyads.com', 'ad.gt', 'stackadapt.com', 'stickyadstv.com', 'spotxchange.com', 'spotx.tv', 'springserve.com',
    'adkernel.com', 'adzerk.net', 'adgrx.com', 'admixer.net', 'districtm.io', 'emxdgt.com', 'lkqd.net', 'lkqd.com',
    'smaato.net', 'smaato.com', 'inmobi.com', 'inmobicdn.net', 'adtelligent.com', 'vidoomy.com', 'aniview.com', 'improvedigital.com',
    '360yield.com', 'adhese.com', 'adhigh.net', 'adsymptotic.com', 'quantcount.com', 'yieldone.com', 'zemanta.com',
    'mediavine.com', 'adthrive.com', 'raptive.com', 'ezoic.net', 'ezodn.com', 'ezojs.com', 'freestar.com', 'pub.network',
    'snigelweb.com', 'setupad.net', 'adpushup.com', 'sortable.com', 'monetizemore.com', 'venatusmedia.com', 'nitropay.com',
    'adsafeprotected.com', 'moatads.com', 'moatpixel.com', 'doubleverify.com', 'dvtps.com',
    'insightexpressai.com', 'serving-sys.com', 'flashtalking.com', 'sizmek.com', 'eyeblaster.com', 'mediaplex.com',
    'adroll.com', 'perfectaudience.com', 'nextroll.com', 'zedo.com', 'atdmt.com', 'adhigh.net', 'yieldify.com',
    'dotomi.com', 'conversantmedia.com', 'mathtag.com', 'mookie1.com', 'turn.com', 'amobee.com', 'tremorhub.com',
    'tremorvideo.com', 'telaria.com', 'videohub.tv', 'unrulymedia.com', 'innovid.com', 'adcolony.com', 'vungle.com', 'liftoff.io',
    'applovin.com', 'applvn.com', 'unityads.unity3d.com', 'chartboost.com', 'mopub.com', 'startapp.com', 'startappservice.com',
    'ironsrc.com', 'ironsrc.mobi', 'ironsource.mobi', 'supersonicads.com', 'fyber.com', 'inner-active.mobi', 'tapjoy.com',
    'pangleglobal.com', 'pangle.io', 'byteoversea.net', 'mintegral.com', 'mintegral.net', 'rayjump.com', 'yandex.ru/ads',
    'nativeads.com', 'nativo.com', 'ntv.io', 'postrelease.com', 'plista.com', 'ligatus.com', 'adblade.com', 'content.ad',
    'revcontent.com', 'mgid.com', 'zergnet.com', 'taboola.com', 'taboolasyndication.com', 'outbrain.com', 'outbrainimg.com',
    'adsupply.com', 'adspirit.de', 'adskeeper.co.uk', 'adskeeper.com', 'bidvertiser.com', 'infolinks.com', 'yllix.com',
    'buysellads.com', 'buysellads.net', 'carbonads.com', 'carbonads.net', 'srv.buysellads.com', 'propellerads.com',
    'propellerclick.com', 'onclickads.net', 'adcash.com', 'hilltopads.net', 'adsterra.com', 'admaven.com', 'clickadu.com',
    'pushground.com', 'richpush.co', 'evadav.com', 'galaksion.com', 'adxpansion.com', 'ad-maven.com', 'a-ads.com',
    'coinzilla.com', 'bitmedia.io', 'cointraffic.io', 'primis.tech', 'ex.co', 'playwire.com', 'connatix.com',     'adnium.com', 'ad4m.at', 'adgear.com', 'adlightning.com', 'confiant-integrations.net', 'adsafety.net',
    'gammaplatform.com', 'seedtag.com', 'missena.io', 'optad360.io', 'quantum-advertising.com', 'ogury.io', 'presage.io',
    'adtarget.com.tr', 'adman.gr', 'clickio.com', 'clickiocdn.com', 'clickiocmp.com', 'onetag-sys.com', 'onetag.com',
    'richaudience.com', 'e-planning.net', 'mediasmart.io', 'adsmovil.com', 'tappx.com', 'sublime.xyz', 'ayads.co',
    'admatic.com.tr', 'adnow.com', 'adsco.re', 'adf.ly',     // Brasil e Portugal
    't.dynad.net', 'dynad.net', 'tailtarget.com', 'navdmp.com', 'navegg.com',
    'boo-box.com', 'zanox.com',             // Verificação, prebid e cabeçalhos de lances
    'prebid.adnxs.com', 'hbopenbid.pubmatic.com', 'ads.pubmatic.com', 'fastlane.rubiconproject.com',
    'pixel.adsafeprotected.com', 'static.adsafeprotected.com', 'fw.adsafeprotected.com', 'cdn.doubleverify.com', 'tps.doubleverify.com',
  ],

  video: [
    '~dai.google.com', 'imasdk.googleapis.com/pal', 'g.jwpsrv.com', 'jwpsrv.com', 'prd.jwpltx.com', 'jwpltx.com',
    'ssl.p.jwpcdn.com/player/plugins/googima', 'ssl.p.jwpcdn.com/player/plugins/vast', 'fwmrm.net', 'freewheel.tv',
    'stickyadstv.com', 'cd.connatix.com', 'capi.connatix.com', 'vid.connatix.com', 'connatix.com',
    'metrics.brightcove.com', 'innovid.com', 's.innovid.com', 'tremorhub.com', 'ads.tremorhub.com', 'spotxcdn.com',
    'springserve.net', 'vidazoo.com', 'aniview.com', 'vidoomy.com', 'videoo.tv', 'beachfront.io',
    'bfmio.com', 'cedato.com', 'jivox.com', 'extremereach.io', 'yumenetworks.com',     'adotmob.com', 'vi.ai', 'vi-serve.com', 'vidible.tv',     'lkqd.net', 'aerserv.com', 'pubads.g.doubleclick.net/gampad/ads',
    'securepubads.g.doubleclick.net/gampad/ads', 'googleads.g.doubleclick.net/pagead/ads',   ],

  trackers: [
    // Google
    'google-analytics.com', 'googletagmanager.com', '~tagmanager.google.com', 'analytics.google.com', 'app-measurement.com',
    'click.googleanalytics.com', 'googleanalytics.com', 'firebaselogging-pa.googleapis.com', 'firebaselogging.googleapis.com',
    'stats.g.doubleclick.net', 'google.com/ads/ga-audiences', 'google.com/pagead/1p-conversion', 'google.com/pagead/1p-user-list',
    // Grandes plataformas de analytics
    'omtrdc.net', 'demdex.net', 'everesttech.net', '2o7.net', 'metrics.adobe.com', 'analytics.adobe.io', 'adobedc.net',
    'scorecardresearch.com', 'comscore.com', 'imrworldwide.com', 'nmrodam.com', 'quantserve.com', 'quantcount.com',
    'chartbeat.com', 'chartbeat.net', 'parsely.com', 'parse.ly', 'mixpanel.com', 'mxpnl.com',
    'mxpnl.net', 'segment.io', 'segment.com', 'amplitude.com', 'heap.io', 'heapanalytics.com', 'kissmetrics.com',
    'kissmetrics.io', 'mparticle.com', 'rudderstack.com', 'rudderlabs.com', 'snowplowanalytics.com', 'posthog.com',
    'i.posthog.com', 'tealiumiq.com', 'tiqcdn.com', 'ensighten.com', 'cloudflareinsights.com', 'matomo.cloud',
    'piwik.pro', 'containers.piwik.pro', 'plausible.io', 'usefathom.com', 'simpleanalyticscdn.com', 'cloud.umami.is',
    'pirsch.io', 'gc.zgo.at', 'counter.dev', 'statcounter.com', 'histats.com', 'clicky.com', 'getclicky.com', 'static.getclicky.com',
    'woopra.com', 'gaug.es', 'stats.wp.com', 'pixel.wp.com', 'stats.pusher.com', 'countly.com',     'sessionstack.com',
    // Gravação de sessão e mapas de calor
    'hotjar.com', 'hotjar.io', 'mouseflow.com', 'crazyegg.com', 'luckyorange.com', 'luckyorange.net', 'fullstory.com',
    'clarity.ms', 'inspectlet.com', 'smartlook.com', 'smartlook.cloud', 'freshmarketer.com', 'sessioncam.com',
    'decibelinsight.net', 'contentsquare.net', 'quantummetric.com', 'glassboxdigital.io', 'clicktale.net',     'mc.yandex.ru', 'mc.yandex.com', 'metrika.yandex.ru', 'appmetrica.yandex.ru', 'appmetrica.yandex.com', 'mc.webvisor.org',
    'mc.webvisor.com', 'hm.baidu.com', 'cnzz.com', 'umeng.com', 'growingio.com', 'top-fwz1.mail.ru', 'top.mail.ru',
    'tns-counter.ru', 'gemius.pl', 'hit.gemius.pl', 'cxense.com', 'permutive.com', 'permutive.app',     'analytics.yahoo.com', '~quantcast.com', 'tagcommander.com', 'commander1.com', 'aptrinsic.com',
    // Dados, identidade e impressão digital (fingerprinting)
    'bluekai.com', 'krxd.net', 'exelator.com', 'eyeota.net', 'lotame.com', 'crwdcntrl.net', 'tapad.com', 'rlcdn.com',
    'liveramp.com', 'agkn.com', 'pippio.com', 'id5-sync.com', 'uidapi.com', 'prod.uidapi.com', 'mathtag.com', 'w55c.net',
    'simpli.fi', 'sitescout.com', 'adsymptotic.com', 'zeotap.com', 'liadm.com', 'liveintent.com', 'bounceexchange.com',
    'bouncex.net', 'wunderkind.co', 'fingerprintjs.com', 'fpjs.io', 'fpcdn.io', 'fpnpmcdn.net', 'openfpcdn.io',
    'siftscience.com',     'adsco.re', 'addthis.com', 'addthisedge.com', 'sharethis.com', 'sharethrough.com',
    'branch.io', 'bnc.lt', 'app.link', 'adjust.com', 'adjust.io', 'adj.st', 'appsflyer.com', 'appsflyersdk.com', 'onelink.me',
    'kochava.com', 'singular.net', 'sng.link', 'wzrkt.com', 'clevertap-prod.com', 'tenjin.com', 'tenjin.io', 'airbridge.io',
    'dpm.demdex.net', 'cdn.permutive.com',     // Brasil
    'navegg.com', 'tailtarget.com',       ],

  social: [
    // Meta
    'pixel.facebook.com', 'an.facebook.com', 'tr.facebook.com', 'facebook.com/tr', 'facebook.com/plugins', 'connect.facebook.net',
    'graph.facebook.com', 'graph.instagram.com', 'i.instagram.com', 'ads.facebook.com',
    'business.facebook.com/tr', 'facebook.net/signals',
    // X / Twitter
    'ads-twitter.com', 'static.ads-twitter.com', 'ads-api.twitter.com', 'ads-api.x.com', 'analytics.twitter.com',
    'analytics.x.com', 'ads.x.com', 'ads.twitter.com', 't.co/i/adsct', 'twitter.com/i/adsct', 'x.com/i/adsct',
    'syndication.twitter.com/i/jot', 'platform.twitter.com/widgets.js', 'platform.twitter.com/oct.js',
    // LinkedIn, Microsoft
    'ads.linkedin.com', 'px.ads.linkedin.com', 'dc.ads.linkedin.com', 'analytics.pointdrive.linkedin.com', 'snap.licdn.com',
    'linkedin.com/px', 'platform.linkedin.com',
    // TikTok / ByteDance
    'analytics.tiktok.com', 'analytics-sg.tiktok.com', 'ads.tiktok.com', 'ads-sg.tiktok.com', 'ads-api.tiktok.com',
    'business-api.tiktok.com', 'log.byteoversea.com', 'mon.byteoversea.com', 'mcs-va.tiktokv.com', 'mon.tiktokv.com',
    'mcs.tiktokv.com', 'log.tiktokv.com', 'mssdk.tiktokw.us',
    // Snapchat, Pinterest, Reddit, Quora, outros
    'sc-static.net', 'tr.snapchat.com', 'tr-shadow.snapchat.com', 'ads.snapchat.com', 'sc-analytics.appspot.com',
    'ads.pinterest.com', 'ct.pinterest.com', 'log.pinterest.com', 'analytics.pinterest.com', 'trk.pinterest.com',
    'widgets.pinterest.com', 'events.reddit.com', 'events.redditmedia.com', 'alb.reddit.com', 'ads.reddit.com',
    'pixel.redditmedia.com', 'd.reddit.com', 'reddit.com/rp.gif', 'pixel.quora.com', 'qevents.quora.com', 'px.srvcs.tumblr.com',
    'ads.vk.com', 'vk.com/rtrg', 'top-fwz1.mail.ru', 'ad.mail.ru', 'px.ads.vk.com',     'ads.nextdoor.com', 'flask.nextdoor.com', 'sp.analytics.yahoo.com',   ],

  affiliate: [
    'anrdoezrs.net', 'dpbolvw.net', 'tkqlhce.com', 'jdoqocy.com', 'kqzyfj.com', 'awltovhc.com', 'ftjcfx.com', 'lduhtrp.net',
    'tqlkg.com', 'emjcd.com', 'cj.com', 'qksrv.net', 'shareasale.com', 'shareasale-analytics.com', 'linksynergy.com',
    'click.linksynergy.com', 'ad.linksynergy.com', 'track.linksynergy.com', 'impactradius-event.com', 'impactradius-go.com',
    'ojrq.net', 'sjv.io', 'pxf.io', 'awin1.com', 'zenaps.com', 'prf.hn', 'dwin1.com', 'tradedoubler.com',
    'clk.tradedoubler.com', 'webgains.com', 'partnerize.com', 'partnerstack.com', 'refersion.com', 'pepperjamnetwork.com',
    'pjtra.com', 'pjatr.com', 'gopjn.com', 'skimresources.com', 'skimlinks.com', 'redirectingat.com', 'viglink.com',
    'linkby.com', 'avantlink.com', 'flexoffers.com', 'admitad.com', 'ad.admitad.com', 'cityads.com',
    'lomadee.com', 'afilio.com.br', 'rakutenmarketing.com', 'linkconnector.com', 'clickbank.net',
    'hop.clickbank.net', 'go2cloud.org', 'hasoffers.com', 'everflow.io', 'tapfiliate.com',
    'firstpromoter.com', 'rewardful.com', 'wdfl.co', 'yieldkit.com', 'getreditus.com',     'narrativ.com', 'rakuten-advertising.com',
  ],

  telemetry: [
    // Apple
    'iadsdk.apple.com', 'api-adservices.apple.com', 'advertising.apple.com', 'metrics.apple.com', 'metrics.icloud.com',
    'metrics.mzstatic.com', 'xp.apple.com', 'books-analytics-events.apple.com', 'notes-analytics-events.apple.com',
    'weather-analytics-events.apple.com', 'stocks-analytics-events.apple.com', 'news-events.apple.com',
    'iphonesubmissions.apple.com', 'radarsubmissions.apple.com', 'securemetrics.apple.com', 'supportmetrics.apple.com',
    // Samsung
    'samsungads.com', 'samsungacr.com', 'samsungqbe.com', 'samsungrm.net', 'samsungadhub.com', 'smetrics.samsung.com',
    'nmetrics.samsung.com', 'samsung-com.112.2o7.net', 'analytics-api.samsunghealthcn.com', 'config.samsungads.com',
    'ad.samsungadhub.com', 'gpm.samsungqbe.com', 'log-config.samsungacr.com', 'acr0.samsungcloudsolution.com',
    // Xiaomi
    'ad.xiaomi.com', 'ad.intl.xiaomi.com', 'ad.mi.com', 'mistat.xiaomi.com', 'mistat.india.xiaomi.com', 'mistat.rus.xiaomi.com',
    'mistat.intl.xiaomi.com', 'tracking.miui.com', 'tracking.rus.miui.com', 'tracking.intl.miui.com', 'adv.sec.miui.com',
    'adv.sec.intl.miui.com', 'sa.api.intl.miui.com', 'api.ad.xiaomi.com', 'globalapi.ad.xiaomi.com',
    // Huawei / Honor
    'metrics.data.hicloud.com', 'metrics1.data.hicloud.com', 'metrics2.data.hicloud.com', 'metrics-dra.dt.hicloud.com',
    'logservice.hicloud.com', 'logservice1.hicloud.com', 'logbak.hicloud.com', 'grs.hicloud.com', 'events.op.hicloud.com',
    'adx-dre.op.hicloud.com', 'ads.huawei.com', 'pps-ads.huawei.com', 'iads.hihonor.com',
    // Oppo, Realme, OnePlus, Vivo
    'adsfs.oppomobile.com', 'ads.oppomobile.com', 'adx.ads.oppomobile.com', 'ck.ads.oppomobile.com', 'data.ads.oppomobile.com',
    'adsfs-sdkconfig.heytapimage.com', 'iot-eu-logser.realme.com', 'iot-logser.realme.com', 'bdapi-ads.realmemobile.com',
    'bdapi-in-ads.realmemobile.com', 'click.oneplus.cn', 'open.oneplus.net', 'analytics.oneplus.cn', 'adlog.vivo.com',
    'ads-api.vivo.com', 'adsdk.vivo.com.cn', 'stdads.vivo.com.cn',
    // Lenovo, Motorola, Asus, Nvidia
    'a.lenovo.com', 'telemetry.gfe.nvidia.com', 'events.gfe.nvidia.com', 'gfwsl.geforce.com',
    // TVs (LG, Roku, Vizio, Samsung, TCL)
    'lgsmartad.com', 'info.lgsmartad.com', 'us.info.lgsmartad.com', 'ibs.lgappstv.com', 'ad.lgappstv.com', 'ngfts.lge.com',
    'lgtvsdp.com', 'smartclip.net', 'smartclip.com', 'logs.roku.com', 'ads.roku.com', 'amoeba.web.roku.com', 'ravm.tv',
    'ads.vizio.com', 'tvinteractive.tv', 'tvpixel.com', 'samba.tv', 'alphonso.tv', 'inscape.tv',     // Microsoft / Windows / Office
    'events.data.microsoft.com', 'vortex.data.microsoft.com', 'vortex-win.data.microsoft.com', 'settings-win.data.microsoft.com',
    'telemetry.microsoft.com', 'watson.microsoft.com', 'events.data.msn.com', 'browser.events.data.msn.com',
    'pipe.aria.microsoft.com', 'telemetry.urs.microsoft.com', 'telecommand.telemetry.microsoft.com',
    // Amazon (Fire TV, Kindle, Alexa)
    'device-metrics-us.amazon.com', 'device-metrics-us-2.amazon.com', 'mads.amazon.com', 'mads-eu.amazon.com',
    'mads-fe.amazon.com', 'unagi.amazon.com', 'unagi-na.amazon.com', 'unagi-eu.amazon.com',
    // Google / Android / outros
    'crashlytics.com', 'firebase-settings.crashlytics.com', 'reports.crashlytics.com', 'incoming.telemetry.mozilla.org',
    'telemetry.dropbox.com', 'telemetry.malwarebytes.com',   ],

  errors: [
    'sentry.io', 'sentry-cdn.com', 'getsentry.com', 'ingest.sentry.io', 'bugsnag.com', 'bugsnag-builds.com', 'rollbar.com',
    'raygun.io', 'raygun.com', 'trackjs.com', 'lr-ingest.com', 'lr-ingest.io', 'lr-in-prod.com', 'logr-ingest.com',
    'logrocket.com', 'logrocket.io', 'browser-intake-datadoghq.com', 'browser-intake-datadoghq.eu',
    'browser-intake-us3-datadoghq.com', 'browser-intake-us5-datadoghq.com', 'browser-intake-ap1-datadoghq.com',
    'datadoghq-browser-agent.com', 'nr-data.net', 'js-agent.newrelic.com', 'bam.nr-data.net', 'bam-cell.nr-data.net',
    'js-cdn.dynatrace.com', 'eum-appdynamics.com', 'cdn.appdynamics.com', 'honeybadger.io', 'airbrake.io',
    'errorception.com', 'loggly.com', 'appsignal-endpoint.net', 'highlight.io', 'highlight.run', 'openreplay.com',
    'eum.instana.io', 'speedcurve.com', 'go-mpulse.net', 'catchjs.com', 'muscula.com', 'ingest.lightstep.com',
    'rum.hlx.page', 'rum-static.pingdom.net', 'rum-collector.pingdom.net',   ],

  consent: [
    'cookielaw.org', 'onetrust.com', 'onetrust.io', 'cookiepro.com', 'cookiebot.com', 'cookiebot.eu', 'consentmanager.net',
    'consentmanager.de', 'usercentrics.eu', 'usercentrics.com', 'trustarc.com', 'truste.com', 'privacy-mgmt.com',
    'privacy-center.org', 'didomi.io', 'consensu.org', 'cmp.inmobi.com', 'quantcast.mgr.consensu.org', 'cmp.quantcast.com',
    'choice.faktor.io', 'faktor.io', 'iubenda.com', 'termly.io', 'osano.com', 'cookieyes.com', 'cdn-cookieyes.com',
    'cookie-script.com', 'cookiehub.net', 'cookiefirst.com', 'civiccomputing.com', 'axept.io', 'axeptio.eu',
    'cookieinformation.com', 'evidon.com', 'ketchcdn.com', 'ketchjs.com', 'transcend-cdn.com',
    'enzuzo.com', 'consentframework.com', 'sirdata.com', 'privacymanager.io', 'gdpr.privacymanager.io',
    'secureprivacy.ai', 'uniconsent.com', 'clickiocmp.com', 'cmp.clickio.com', 'appconsent.io', 'sfbx.io',     'trustcommander.net', 'cookie-cdn.cookiepro.com', 'geolocation.onetrust.com', 'optanon.blob.core.windows.net',
    'js.hs-banner.com', 'cookiereports.com',     'pandectes.io', 'consentmo.com', 'cookiefirst.net', 'cmp.osano.com',
    'sdk.privacy-center.org', 'app.usercentrics.eu', 'cmp.usercentrics.eu', 'consent.trustarc.com', 'consent-pref.trustarc.com',
  ],

  experiments: [
    'optimizely.com', 'optimizelyapis.com', 'abtasty.com', 'visualwebsiteoptimizer.com', 'wingify.com',
    'kameleoon.eu', 'kameleoon.io', 'kameleoon.com', 'convertexperiments.com', 'dynamicyield.com',
    'dy-api.com', 'dy-api.eu', 'monetate.net', 'qubit.com', 'goqubit.com', 'qubitproducts.com', 'sitespect.com',
    'omniconvert.com', 'zarget.com', 'evgnet.com', 'evergage.com', 'mutinycdn.com', 'mutinyhq.io', 'intellimize.co',
    'webtrends-optimize.com', 'conductrics.com', 'googleoptimize.com',     'events.launchdarkly.com', 'clientstream.launchdarkly.com',     'try.abtasty.com', 'ariane.abtasty.com', 'cdn.dynamicyield.com', 'st.dynamicyield.com',
    'async-px.dynamicyield.com', 'cdn.optimizely.com', 'logx.optimizely.com', 'api.optimizely.com',       ],

  messaging: [
    // E-mail marketing
    'list-manage.com', 'click.mailchimp.com', 'chimpstatic.com', 'mailchi.mp', 'track.hubspot.com',
    'js.hs-analytics.net', 'js.hs-scripts.com', 'js.hsadspixel.net', 'js.hscollectedforms.net', 'js.hsleadflows.net',
    'js.usemessages.com', 'munchkin.marketo.net', 'mktoresp.com', 'mktdns.com', 'trackcmp.net',
    'pi.pardot.com', 'en25.com', 't.eloqua.com', 'ct.sendgrid.net',
    'sendgrid.net/wf/open', 'mandrillapp.com/track', 'emltrk.com', 'mailtrack.io', 'getnotify.com',
    'bananatag.com', 't.yesware.com', 'mailfoogae.appspot.com', 'sail-horizon.com', 'ak.sail-horizon.com',
    'klaviyo.com', 'static.klaviyo.com', 'a.klaviyo.com', 'static-tracking.klaviyo.com', 'omnisnippet1.com', 'omnisrc.com',
    'tag.getdrip.com', 'getdrip.com', 'iterable.com', 'js.iterable.com', 'exponea.com', 'useinsider.com',
    'customer.io', 'track.customer.io', 'assets.customer.io', 'braze.com', 'appboycdn.com', 'sdk.iad-01.braze.com',
    'sdk.iad-03.braze.com', 'sdk.iad-05.braze.com', 'sdk.fra-01.braze.eu', 'sdk.fra-02.braze.eu',     'd335luupugsy2.cloudfront.net/js/loader-scripts',     'emarsys.net', 'scarabresearch.com', 'cordial.io', 'bluecore.com',
    'listrak.com', 'listrakbi.com', 'attentivemobile.com', 'attn.tv', 'postscript.io', 'smsbump.com', 'privy.com', 'privymktg.com',
    'justuno.com', 'optinmonster.com', 'omappapi.com', 'optmnstr.com', 'sumo.com', 'sumome.com', 'wisepops.com', 'poptin.com',
    'convertflow.co', 'hellobar.com', 'getsitecontrol.com', 'sleeknote.com', 'mailmunch.co',     // Notificações push
    'onesignal.com', 'cdn.onesignal.com', 'api.onesignal.com', 'pushengage.com', 'webpushr.com', 'izooto.com', 'pushcrew.com',
    'sendpulse.com', 'webpushs.com', 'wonderpush.com', 'aimtell.com', 'moengage.com', 'pushwoosh.com', 'pushnami.com',
    'gravitec.net', 'subscribers.com', 'pushassist.com', 'truepush.com', 'notix.io', 'pushpushgo.com', 'pushowl.com',
    'cleverpush.com', 'pushalert.co', 'feedify.net',     // Chat ao vivo
    'widget.intercom.io', 'intercomcdn.com', 'api-iam.intercom.io', 'nexus-websocket-a.intercom.io', 'js.driftt.com',
    'driftt.com', 'drift.com', 'event.api.drift.com', 'zopim.com', 'v2.zopim.com', 'ekr.zdassets.com', 'embed.tawk.to',
    'va.tawk.to', 'tawk.to', 'livechatinc.com', 'cdn.livechatinc.com', 'livechat-files.com', 'client.crisp.chat',
    'crisp.chat', 'static.olark.com', 'olark.com', 'code.tidio.co', 'tidiochat.com', 'wchat.freshchat.com', 'freshchat.com',
    'smartsuppchat.com', 'smartsupp.com', 'code.jivosite.com', 'jivosite.com', 'jivochat.com', 'call.chatra.io', 'chatra.io',
    'purechat.com', 'comm100.com', 'lpsnmedia.net', 'liveperson.net', 'config.gorgias.chat', 'beacon-v2.helpscout.net',
    'chat-assets.frontapp.com', 'chaport.com', 'salesiq.zoho.com', 'salesiq.zohopublic.com', 'widget.manychat.com',
    'kommunicate.io', 'userlike.com', 'userlike-cdn-widgets.s3-eu-west-1.amazonaws.com', 'snapengage.com', 'velaro.com',
    'boldchat.com', 'websitealive.com', 'chatwoot.com', 'landbot.io', 'botsonic.com', 'tiledesk.com',     'gist.build', 'getgist.com', 'zendesk.com/embeddable_framework', 'static.zdassets.com/ekr', 'widget.trengo.eu',
    'helpcrunch.com', 'livehelperchat.com', 'carrot.io', 'qualified.com', 'js.qualified.com',   ],

  malware: [
    // Mineradores de criptomoeda
    'coinhive.com', 'coin-hive.com', 'jsecoin.com', 'cryptoloot.pro', 'crypto-loot.com', 'webminepool.com', 'minero.cc',
    'coinimp.com', 'authedmine.com', 'mineralt.io', 'monerominer.rocks', 'coinerra.com', 'coin-have.com',     'hashing.win', 'webmine.cz', 'ppoi.org', 'projectpoi.com', 'minr.pw',     'jsminer.net', 'cpu2cash.link', 'monero-miner.net', 'gridcash.net', 'nerohut.com', 'cryptaloot.pro', 'cloudcoins.co',
    // Pop-ups, malvertising e golpes
    'popads.net', 'popcash.net', 'popmyads.com', 'popunder.net', 'clickadu.com', 'trafficjunky.net', 'trafficjunky.com',
    'exoclick.com', 'exosrv.com', 'juicyads.com', 'adxxx.com', 'trafficfactory.biz', 'trafficstars.com', 'tsyndicate.com',
    'plugrush.com', 'ero-advertising.com', 'realsrv.com', 'magsrv.com', 'statdynamic.com', 'onclkds.com', 'onclickmax.com',
    'onclickperformance.com', 'adsterra.com', 'highperformanceformat.com', 'profitablegatecpm.com', 'displaycontentnetwork.com',
    'pushails.com', 'push-notifications.top', 'notifpushing.com', 'luckypushh.com', 'mobiletracking.ru', 'xmladfeed.com',
    'clickaine.com', 'adspyglass.com', 'zeroredirect1.com', 'zeroredirect2.com', 'redirectvoluum.com', 'voluum.com/click',
        'adf.ly', 'ouo.press', 'shrinkme.io', 'shrinkearn.com', 'sh.st', 'clk.sh',
    'cdn.tapioni.com', 'ad.a-ads.com',   ],
};

module.exports = { CATEGORIES, RULES };
