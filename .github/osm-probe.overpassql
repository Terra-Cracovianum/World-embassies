[out:json][timeout:120];
(
  nwr[~"^(name|name:en|name:zh|official_name|operator)$"~"Pol(and|ish|ska|ogne|en)|波蘭|波兰",i](22.15,113.95,22.45,114.35);
  nwr[~"^(name|name:en|name:zh)$"~"consul|領事|领事",i](22.15,113.95,22.45,114.35);
  nwr["office"="diplomatic"](22.15,113.95,22.45,114.35);
  nwr["office"="consulate"](22.15,113.95,22.45,114.35);
  nwr["diplomatic"](22.15,113.95,22.45,114.35);
  nwr["amenity"="embassy"](22.15,113.95,22.45,114.35);
);
out center tags;
