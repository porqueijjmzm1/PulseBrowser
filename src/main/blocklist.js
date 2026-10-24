'use strict';
// Lista interna do Pulse Shield: domínios de anúncios e rastreadores conhecidos.
// Subdomínios também são bloqueados (ex.: "stats.g.doubleclick.net").
module.exports = [
  // Google Ads / Analytics
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com',
  'googletagservices.com', 'googletagmanager.com', 'adservice.google.com', 'pagead2.googlesyndication.com',
  'app-measurement.com', 'ssl.google-analytics.com', 'analytics.google.com',
  // Redes de anúncios
  'adnxs.com', 'adsrvr.org', 'rubiconproject.com', 'pubmatic.com', 'openx.net', 'criteo.com', 'criteo.net',
  'casalemedia.com', 'indexww.com', 'amazon-adsystem.com', 'media.net', 'taboola.com', 'outbrain.com',
  'revcontent.com', 'mgid.com', 'zergnet.com', 'sharethrough.com', 'triplelift.com', '33across.com',
  'yieldmo.com', 'smartadserver.com', 'adform.net', 'adition.com', 'teads.tv', 'spotxchange.com',
  'spotx.tv', 'springserve.com', 'contextweb.com', 'sovrn.com', 'lijit.com', 'gumgum.com', 'undertone.com',
  'advertising.com', 'adtech.de', 'adtechus.com', 'yieldlab.net', 'bidswitch.net', 'adsafeprotected.com',
  'moatads.com', 'doubleverify.com', 'serving-sys.com', 'flashtalking.com', 'adroll.com', 'perfectaudience.com',
  'zedo.com', 'popads.net', 'popcash.net', 'propellerads.com', 'propellerclick.com', 'exoclick.com',
  'juicyads.com', 'trafficjunky.net', 'adcash.com', 'hilltopads.net', 'adsterra.com', 'admaven.com',
  'onclickads.net', 'clickadu.com', 'adskeeper.co.uk', 'adskeeper.com', 'bidvertiser.com', 'infolinks.com',
  'yllix.com', 'buysellads.com', 'carbonads.net', 'ad.atdmt.com', 'atdmt.com', 'adhigh.net', 'adkernel.com',
  'adsymptotic.com', 'adzerk.net', 'adgrx.com', 'admixer.net', 'districtm.io', 'emxdgt.com', 'lkqd.net',
  'smaato.net', 'inmobi.com', 'applovin.com', 'unityads.unity3d.com', 'adcolony.com', 'vungle.com',
  'chartboost.com', 'mopub.com', 'startapp.com', 'ironsrc.com', 'supersonicads.com', 'yandexadexchange.net',
  'an.yandex.ru', 'adfox.ru', 'adriver.ru', 'betweendigital.com', 'tradedoubler.com', 'awin1.com',
  'zanox.com', 'webgains.com', 'linksynergy.com', 'cj.com', 'dpbolvw.net', 'anrdoezrs.net', 'jdoqocy.com',
  'kqzyfj.com', 'tkqlhce.com', 'awltovhc.com', 'ftjcfx.com', 'shareasale.com', 'skimresources.com',
  'skimlinks.com', 'viglink.com', 'nativeads.com', 'nativo.com', 'plista.com', 'ligatus.com', 'adblade.com',
  'content.ad', 'adsupply.com', 'adspirit.de', 'adtelligent.com', 'vidoomy.com', 'aniview.com',
  'connatix.com', 'primis.tech', 'ex.co', 'playwire.com', 'freewheel.tv', 'stickyadstv.com',
  // Rastreadores e analytics
  'scorecardresearch.com', 'quantserve.com', 'quantcount.com', 'hotjar.com', 'hotjar.io', 'mouseflow.com',
  'crazyegg.com', 'luckyorange.com', 'fullstory.com', 'clarity.ms', 'inspectlet.com', 'smartlook.com',
  'mixpanel.com', 'segment.io', 'segment.com', 'amplitude.com', 'heap.io', 'heapanalytics.com',
  'kissmetrics.com', 'chartbeat.com', 'chartbeat.net', 'parsely.com', 'newrelic.com', 'nr-data.net',
  'omtrdc.net', 'demdex.net', 'everesttech.net', '2o7.net', 'bluekai.com', 'krxd.net', 'exelator.com',
  'eyeota.net', 'lotame.com', 'crwdcntrl.net', 'tapad.com', 'rlcdn.com', 'liveramp.com', 'agkn.com',
  'adsymptotic.com', 'mathtag.com', 'mookie1.com', 'turn.com', 'w55c.net', 'simpli.fi', 'sitescout.com',
  'addthis.com', 'addthisedge.com', 'sharethis.com', 'mxpnl.com', 'statcounter.com', 'histats.com',
  'clicky.com', 'getclicky.com', 'woopra.com', 'mc.yandex.ru', 'top-fwz1.mail.ru',
  'tns-counter.ru', 'gemius.pl', 'hit.gemius.pl', 'cxense.com', 'permutive.com', 'permutive.app',
  'branch.io', 'adjust.com', 'appsflyer.com', 'kochava.com', 'singular.net',
  'bat.bing.com', 'ads.linkedin.com', 'px.ads.linkedin.com', 'snap.licdn.com', 'analytics.twitter.com',
  'ads-twitter.com', 'static.ads-twitter.com', 'ads.pinterest.com', 'ct.pinterest.com', 'analytics.tiktok.com',
  'ads.tiktok.com', 'business-api.tiktok.com', 'pixel.facebook.com',
  'an.facebook.com', 'ads.reddit.com', 'events.redditmedia.com', 'alb.reddit.com', 'ads.yahoo.com',
  'analytics.yahoo.com', 'gemini.yahoo.com', 'adtech.yahooinc.com', 'sp.analytics.yahoo.com',
  'ads.yieldmo.com', 'trc.taboola.com', 'cdn.taboola.com', 'widgets.outbrain.com', 'zemanta.com',
  'pippio.com', 'bounceexchange.com', 'bouncex.net', 'wunderkind.co', 'tealiumiq.com', 'tiqcdn.com',
  'ensighten.com', 'mparticle.com', 'rudderstack.com', 'snowplowanalytics.com', 'matomo.cloud',
  
  
  'imrworldwide.com', 'comscore.com', 'sc-static.net', 'tr.snapchat.com',
  'adsafety.net', 'adlightning.com', 'confiant-integrations.net', 
  // Mineradores de criptomoeda
  'coinhive.com', 'coin-hive.com', 'jsecoin.com', 'cryptoloot.pro', 'crypto-loot.com', 'webminepool.com',
  'minero.cc', 'coinimp.com', 'authedmine.com',
];
