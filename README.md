# What is this?

In an effort to make curating categories of work easier, sometimes it's good to be able to watch the blockchain for stories with certain keywords in them.

This is the source code for the steem-seeress bot that runs on Discord. You don't need to do anything with this code to use the bot, please see the article detailing how to use the seeress at:

https://steemit.com/tools/@triddin/introducing-steem-seeress-bot-for-discord

# Match format

The Seeress will look at the channel topic of any channel of the server she is on. If she sees a topic that contains the following:

ABNF specification.
~~~
   topic-list  = "steem-seeress=" match-set *1TERM

   match_set   = match *( ":" match )
   match       = key-field *( "," key-field )
   key-field   = *WSP key-word *WSP
   key-word    = key-type key-text
   key-type    = *1NEG *1TYP / VOTE
   key-text    = 1*<any UTF8 except SEP>

   COLON       = ":"
   SEMICOLON   = ";"
   SPACE       = " "
   TAB         = %x09
   NEWLINE     = %x0a
   TERM       `= SEMICOLON / NEWLINE    ; topic list terminator
   SEP         = TERM / COLON           ; item separator
   WSP         = SPACE / TAB            ; whitespace
   NEG         = "!" / "-"              ; negating operator
   TYP         = "@" / "#"              ; type operator
   VOTE        = "$"                    ; vote operator

   UTF8        = UTF8-1 / UTF8-2 / UTF8-3 / UTF8-4
   UTF8-1      = %x00-7F
   UTF8-2      = %xC2-DF UTF8-tail
   UTF8-3      = %xE0 %xA0-BF UTF8-tail / %xE1-EC 2( UTF8-tail ) /
                 %xED %x80-9F UTF8-tail / %xEE-EF 2( UTF8-tail )
   UTF8-4      = %xF0 %x90-BF 2( UTF8-tail ) / %xF1-F3 3( UTF8-tail ) /
                 %xF4 %x80-8F 2( UTF8-tail )
   UTF8-tail   = %x80-BF
~~~

Some examples:
~~~
steem-seeress=bicycle, wheel, axle, @bikerboy, !@wheelsmadman : train, carriage, !steam train, #locomotives, @choochoo, $trainguy ;
~~~

This example expands out to:

* Find stories that:
  * HAVE the words "bicycle", "wheel" or "axle" in them anywhere
  * OR are by or reference the author bikerboy
  * BUT are not by or refernce the author wheelsmadman
* As well as stories that:
  * HAVE the words "train" or "carriage" in them anywhere
  * OR have or reference the locomotives tag
  * OR are by or reference the author choochoo
  * BUT DO NOT HAVE the phrase "steam train" in theme anywhere
  * AND list any votes by the voter trainguy on stories we have matched using these criteria

You cah write these rules many different ways, each of which are equivalent:

~~~
steem-seeress=bicycle,wheel,axle,@bikerboy,!@wheelsmadman:train,carriage,!steam train,#locomotives,@choochoo,$trainguy
steem-seeress=bicycle,wheel,axle,@bikerboy,!@wheelsmadman:train,carriage,!steam train,#locomotives,@choochoo,$trainguy;
steem-seeress=@bikerboy,!@wheelsmadman,wheel,axle,bicycle:!steam train,#locomotives,@choochoo,$trainguy,carriage,train;
steem-seeress=bicycle, wheel, axle, @bikerboy, !@wheelsmadman: train, carriage, !steam train, #locomotives, @choochoo, $trainguy
steem-seeress=bicycle, wheel, axle, @bikerboy, !@wheelsmadman: train, carriage, !steam train, #locomotives, @choochoo, $trainguy;
steem-seeress=train, carriage, !steam train, #locomotives, @choochoo, $trainguy : bicycle, wheel, axle, @bikerboy, !@wheelsmadman;
~~~

# Running your own bot

To start up this bot, you will need to:

~~~
npm i
npm run bot
~~~

The first time around, it will generate a `config.json` file and tell you to edit it's options. Do so, then run it again.

