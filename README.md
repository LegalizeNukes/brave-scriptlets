# Brave Scriptlets

Lightweight userscripts for Brave Browser’s Custom Scriptlets feature. Also compatible with custom userscript extensions.

These scriptlets are designed to replace common browser extensions with minimal overhead and zero configuration.

## Disclaimer

All scriptlets in this repository are minified/compactified to comply with the character limits imposed by Brave Browser's Custom Scriptlets feature. As a result, the distributed code may not be easily human-readable.

Users who wish to verify the integrity or behavior of a scriptlet before running it may:

- Use a JavaScript beautifier or formatter to de-minify the code
- Use an LLM to explain or reconstruct the script's logic
- Manually inspect the script themselves

**⚠️ Always review third-party code before executing it in your browser environment. ⚠️**

## Usage

### Brave Browser

For each scriptlet in the `scriptlets` folder:

1. Open `brave://settings/shields/filters/`
2. Create a new custom scriptlet with the specified filename and contents (ignore any commented lines)
3. Paste the provided filter rule into the **Create Custom Filters** box

### Userscript Extensions

If you are using a userscript manager such as Tampermonkey, Violentmonkey, or Greasemonkey (in Brave or another browser), copy the full contents of the corresponding `.user.js` file instead.

# Scriptlets

## Bypass Paywalls

*Adapted from [Bypass Paywalls Clean Filters](https://gitflic.ru/project/magnolia1234/bypass-paywalls-clean-filters)*

Bypasses paywalls on supported news and media websites.

### Setup

Create the scriptlet as:

```txt
user-bypass-paywalls.user.js
```

Then paste the following into the **Create Custom Filters** box:

```js
360dx.com,abqjournal.com,accountingtoday.com,acm.media,adage.com,adelaidenow.com.au,adweek.com,afr.com,ajc.com,al-monitor.com,al.com,americanbanker.com,amp.scmp.com,app.historytoday.com,appan.newscientist.com,architecturaldigest.com,archive.today,artnet.com,asia.nikkei.com,audiop.bizjournals.com,autocar.co.uk,autonews.com,autosport.com,axios.com,azcentral.com,backpacker.com,balkaninsight.com,baltimoresun.com,barandbench.com,barrons.com,barrons.djmedia.djservices.io,bendigoadvertiser.com.au,benefitnews.com,benzinga.com,betamtb.com,betternutrition.com,betterprogramming.pub,bhaskar.com,bicycling.com,billboard.com,bizjournals.com,bloomberg.com,bloombergadria.com,bnd.com,bonappetit.com,bondbuyer.com,bordermail.com.au,bostonglobe.com,bostonherald.com,brisbanetimes.com.au,buffalonews.com,business-standard.com,businessdailyafrica.com,businessdesk.co.nz,businessinsider.com,businessinsider.jp,businessoffashion.com,businesspost.ie,businesstimes.com.sg,cairnspost.com.au,canberratimes.com.au,capital.bg,capitalgazette.com,caravanmagazine.in,centralwesterndaily.com.au,charlotteobserver.com,chicagobusiness.com,chicagotribune.com,chronicle.com,cincinnati.com,cleaneatingmag.com,cleveland.com,climbing.com,cnbc.com,cnn.com,cntraveler.com,codesports.com.au,columbian.com,commercialappeal.com,computerweekly.com,cosmopolitan.com,countryliving.com,courant.com,courier-journal.com,couriermail.com.au,crainscleveland.com,crainsdetroit.com,crainsgrandrapids.com,crainsnewyork.com,crikey.com.au,csmonitor.com,ctinsider.com,ctpost.com,curbed.com,cyclingnews.com,dailyadvertiser.com.au,dailyherald.com,dailyliberal.com.au,dailymail.com,dailypress.com,dailyrecord.co.uk,dailytelegraph.com.au,dailywire.com,dallasnews.com,daytondailynews.com,decanter.com,defector.com,delish.com,democratandchronicle.com,denik.cz,denverpost.com,desmoinesregister.com,detroitnews.com,dig-in.com,digiday.com,discovermagazine.com,dispatch.com,dn.no,dnevnik.bg,dwell.com,e.infogram.com,eastbaytimes.com,economictimes.com,economictimes.indiatimes.com,economist.com,elle.com,elledecor.com,elnuevoherald.com,enotes.com,entrepreneur.com,epaper.indiatimes.com,epaper.thetimes.com,epicurious.com,epoch.org.il,espn.com,esquire.com,euobserver.com,european-rubber-journal.com,europower.no,examiner.com.au,express.co.uk,expressnews.com,fastcompany.com,fieldandstream.com,financial-planning.com,financialexpress.com,firstthings.com,fiskeribladet.no,fmrmagazine.com,fnlondon.com,forbes.com,forbes.com.au,forbes.ua,foreignaffairs.com,foreignpolicy.com,fortune.com,foxnews.com,freedium-mirror.cfd,freep.com,fresnobee.com,frontline.thehindu.com,ft.com,ftm.eu,gbnews.com,geelongadvertiser.com.au,genomeweb.com,gitflic.ru,glossy.co,goldcoastbulletin.com.au,goodhousekeeping.com,gq.com,granta.com,grubstreet.com,haaretz.co.il,haaretz.com,harpers.org,harpersbazaar.com,hbr.org,heraldsun.com.au,hilltimes.com,hindustantimes.com,historyextra.com,historytoday.com,housebeautiful.com,houstonchronicle.com,hydrogeninsight.com,iai.tv,illawarramercury.com.au,images.thewest.com.au,images2.dwell.com,inc.com,inc42.com,independent.ie,indianexpress.com,indiatoday.in,indystar.com,infzm.com,inkl.com,inquirer.com,insidehighered.com,insights.citeline.com,interestingengineering.com,intrafish.com,intrafish.no,investors.com,ipolitics.ca,irishexaminer.com,jacksonville.com,japantimes.co.jp,jgnt.co,jobs.reachplc.com,journal-news.com,journalnow.com,journalstar.com,jpost.com,jsonline.com,kansas.com,kansascity.com,kathimerini.gr,kentucky.com,knoxnews.com,kompas.id,kystens.no,latimes.com,lehighvalleylive.com,literaryreview.co.uk,livelaw.in,livemint.com,lrb.co.uk,macrobusiness.com.au,madison.com,magazine.atavist.com,magazine.thediplomat.com,manoramaonline.com,marketwatch.com,masslive.com,mcall.com,mcclatchydc.com,mediaconcierge.co.uk,medium.com,medscape.com,menshealth.com,mercurynews.com,mexiconewsdaily.com,miamiherald.com,mid-day.com,mlive.com,mnimarkets.com,modernhealthcare.com,modernretail.co,motorsportmagazine.com,mwatch.djmedia.djservices.io,nation.africa,nationalgeographic.com,nationalmortgagenews.com,nationalreview.com,nature.com,nautil.us,ndtvprofit.com,newcastleherald.com.au,newcriterion.com,newrepublic.com,news-press.com,newscientist.com,newsday.com,newslaundry.com,newsobserver.com,newstatesman.com,newsweek.com,newyorker.com,nhregister.com,niagarafallsreview.ca,nj.com,nola.com,northerndailyleader.com.au,northjersey.com,ntnews.com.au,nv.ua,nwitimes.com,nybooks.com,nydailynews.com,nymag.com,nypost.com,nypost.nypost.djservices.io,nysun.com,nytimes.com,nzherald.co.nz,observer.co.uk,ocregister.com,oklahoman.com,omaha.com,on3.com,oprahdaily.com,oregonlive.com,orlandosentinel.com,outlookbusiness.com,outlookindia.com,outsideonline.com,oxygenmag.com,palmbeachpost.com,pennlive.com,philanthropy.com,philonomist.com,pilotonline.com,pionline.com,plasticsnews.com,popularmechanics.com,precisionmedicineonline.com,pressenterprise.com,prevention.com,project-syndicate.org,puck.news,readmedium.com,rechargenews.com,reuters.com,reviewjournal.com,richmond.com,roadandtrack.com,rollingstone.com,rotowire.com,rubbernews.com,rugbypass.com,runnersworld.com,sacbee.com,sandiegouniontribune.com,scholastic.com,science.org,scientificamerican.com,scmp.com,scotsman.com,seattletimes.com,sfchronicle.com,sfstandard.com,shreveportbossieradvocate.com,silive.com,skimag.com,slate.com,slideshare.net,sloanreview.mit.edu,sltrib.com,smartcompany.com.au,smh.com.au,sofrep.com,sourcingjournal.com,spglobal.com,sportico.com,springfieldnewssun.com,standard.net.au,standardmedia.co.ke,star-telegram.com,staradvertiser.com,startribune.com,statesman.com,static.ffx.io,statnews.com,stcatharinesstandard.ca,stereogum.com,stltoday.com,stocknews.com,straitstimes.com,stratfor.com,study.com,stylist.co.uk,sun-sentinel.com,swarajyamag.com,syracuse.com,techinasia.com,techtarget.com,telegraph.co.uk,tennessean.com,tes.com,the-american-interest.com,the-scientist.com,the-tls.com,theadvocate.com,theadvocate.com.au,theage.com.au,theamericanconservative.com,theamericanscholar.org,theatlantic.com,theaustralian.com.au,thebanner.com,thebulletin.org,thechronicle.com.au,thecourier.com.au,thecut.com,thedailybeast.com,thediplomat.com,thedispatch.com,theglobeandmail.com,thehill.com,thehindu.com,thehindubusinessline.com,theinformation.com,thejuggernaut.com,thelampmagazine.com,thelawyer.com,theleaflet.in,thelogic.co,themandarin.com.au,themarker.com,themercury.com.au,thenewatlantis.com,thenewslens.com,thenewsminute.com,thenewworld.co.uk,thepeterboroughexaminer.com,thepointmag.com,thequint.com,therecord.com,thesaturdaypaper.com.au,thescottishsun.co.uk,thespec.com,thestage.co.uk,thestar.com,thestate.com,thesun.co.uk,thetimes.com,theweek.com,thewest.com.au,thewrap.com,thisismoney.co.uk,timeshighereducation.com,timesunion.com,tirebusiness.com,tomshardware.com,towardsdatascience.com,townandcountrymag.com,townsvillebulletin.com.au,tradewindsnews.com,trailrunnermag.com,tri-cityherald.com,triathlete.com,tucson.com,tulsaworld.com,twincities.com,unherd.com,upstreamonline.com,utech-polyurethane.com,vanityfair.com,variety.com,vegetariantimes.com,vice.com,vikatan.com,vogue.co.uk,vogue.com,voguebusiness.com,vox.com,vulture.com,warontherocks.com,washingtonpost.com,watoday.com.au,weeklytimesnow.com.au,wellandtribune.ca,westernadvocate.com.au,winnipegfreepress.com,wired.com,womenshealthmag.com,womensrunning.com,worldeconomics.com,wsj.com,wwd.com,ynet.co.il,yogajournal.com,yorkshirepost.co.uk##+js(user-bypass-paywalls.js)
```

## Redirect Google Maps

Redirects Google Maps links to the Apple Maps application.

### Setup

Create the scriptlet as:

```txt
user-redirect-google-maps.user.js
```

Then paste the following into the **Create Custom Filters** box:

```js
google.com##+js(user-redirect-google-maps.js)
```

## Return YouTube Dislikes

*Adapted from [Return YouTube Dislikes Userscript](https://github.com/Anarios/return-youtube-dislike/raw/main/Extensions/UserScript/Return%20Youtube%20Dislike.user.js)*

Restores the dislike counter on YouTube using the Return YouTube Dislike API.

Make sure you use the correct version of the script for your platform (`Desktop` vs. `Mobile`).

### Setup

Create the scriptlet as:

```txt
user-dislikes-youtube.user.js
```

Then paste the following into the **Create Custom Filters** box:

```js
youtube.com##+js(user-dislikes-youtube.js)
```

## SponsorBlock

*Adapted from [sb.js](https://github.com/mchangrh/sb.js)*

Skips sponsored segments in YouTube videos using the SponsorBlock API.

Make sure you use the correct version of the script for your platform (`Desktop` vs. `Mobile`).

### Setup

Create the scriptlet as:

```txt
user-sponsorblock-youtube.user.js
```

Then paste the following into the **Create Custom Filters** box:

```js
youtube.com##+js(user-sponsorblock-youtube.js)
```

## License

This repository is licensed under the MIT License.
