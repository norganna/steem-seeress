var fs = require('fs');
var html_strip = require('htmlstrip-native');
var rpc = require('node-json-rpc');
var Discord = require('discord.io');
var moment = require('moment');

var callrpc = function(name, params, cb) {
	client.call(
			{'jsonrpc': '2.0',
				'method': name,
				'params': params,
				'id': 0},
				function(err, res) {
					if (err) { cb(err, null) }
					else { cb(null, res['result']) }
				}
			);
}

var channels = false

var DEFAULT_TOKEN = 'edit-your-token-in-config.json';
var state = {
	discord_token: DEFAULT_TOKEN,
	steemd_options: {
		port: 8090,
		host: '127.0.0.1',
		path: '/rpc',
		strict: false
	},
    last_block: -1,
    listed: {},
    watching: {}
};

function load() {
    if (!fs.existsSync('config.json')) {
        return;
    }

    var c = fs.readFileSync('config.json', {encoding: 'utf8', flag: 'r'});
    if (c) {
        c = JSON.parse(c);
        if (c) {
            state = c;
        }
    }
}

function save() {
    fs.writeFileSync('config.json', JSON.stringify(state), {encoding: 'utf8', flag: 'w', mode: 0o666});
}

var process_block = function(block, blockid) {
    for (var i = 0; i < block.transactions.length; i++) {
        var t = block.transactions[i];
        if (t.operations) {
            var now = +(new Date);

            for (var j = 0; j < t.operations.length; j++) {
                var o = t.operations[j];
                if (state.debug) {
                    console.log('Found operation', blockid, i, j, o[0]);
                }

                if (o[0] === 'vote') {
                    var v = o[1],
                        voter = v.voter,
                        author = v.author,
                        permlink = v.permlink,
                        list_code = ':'+author+':'+permlink,
                        list_parent = state.listed['P'+list_code],
                        parent_permlink = false;

                    if (list_parent) {
                        // This is one we have listed.
                        for (var cid in channels) {
                            if (!state.listed[cid+list_code]) {
                                // But not by this channel
                                continue;
                            }

                            var chan = channels[cid];

                            if (state.debug) {
                                console.log('Looking at channel', cid, chan);
                            }

                            for (var mi = 0; mi < chan.matches.length; mi++) {
                                var match = chan.matches[mi];

                                if (match.voter && match.voter.test(voter)) {
                                    // This voter matches a voter on the list.
                                    if (!parent_permlink) {
                                        parent_permlink = list_parent.split(':')[1];
                                    }

                                    var seen = +(state.listed['S'+list_code].split(':')[1]);
                                        post_moment = moment(seen),
                                        post_date = post_moment.format("YYYY-MM-DD"),
                                        post_time = post_moment.format("hh:mm"),
                                        post_ago = post_moment.fromNow();

                                    var link = parent_permlink+'/@'+author+'/'+permlink;
                                    bot.sendMessage({
                                        to: cid,
                                        message: 'The story https://steemit.com/' + link + ' posted on ' + post_date + ' at ' + post_time + ' UTC (' + post_ago + ') has been voted on by @' + voter + '.'
                                    });
                                }
                            }
                        }
                    }
                } else if (o[0] === 'comment' && o[1].parent_author === '') {
                    var c = o[1],
                        title = c.title,
                        author = c.author,
                        at_author = '@' + author,
                        parent_permlink = c.parent_permlink,
                        permlink = c.permlink,
                        body = c.body,
                        meta = JSON.parse(c.json_metadata ? c.json_metadata : '{}'),
                        tags = meta.tags,
                        seen = state.listed['S:'+author+':'+permlink];

                    if (seen) {
                        seen = +(seen.split(':')[1]);
                    } else {
                        seen = now;
                    }

                    if (!tags) {
                        tags = [];
                    }

                    tags.unshift(parent_permlink);

                    body = html_strip.html_strip(body, {compact_whitespace: true, include_attributes: { alt: true, title: true }});

                    if (state.debug) {
                        console.log('Processing comment', author, title);
                    }

                    for (var cid in channels) {
                        var chan = channels[cid];

                        if (state.debug) {
                            console.log('Looking at channel', cid, chan);
                        }

                        for (var mi = 0; mi < chan.matches.length; mi++) {
                            var match = chan.matches[mi];

                            var negative_rex = match.negative,
                                positive_rex = match.positive;

                            if (state.debug) {
                                console.log('Checking', cid, mi, positive_rex, negative_rex);
                            }

                            var interested = null;

                            // Check first to see if any of the negatives match, if so, abort.
                            if (!negative_rex) {
                                // No negatives to check, keep on rollin'
                            }

                            else if (negative_rex.test(title)) {
                                console.log('Not interested title');
                                interested = false;
                            }

                            else if (negative_rex.test(at_author)) {
                                console.log('Not interested author');
                                interested = false;
                            }

                            else if (negative_rex.test(body)) {
                                console.log('Not interested body');
                                interested = false;
                            }

                            else for (var k = 0; k < tags.length; k++) {
                                var tag = '#' + tags[k];
                                if (negative_rex.test(tag)) {
                                    console.log('Not interested: ', tag);
                                    interested = false;
                                    break;
                                }
                            }

                            // Now check the positives
                            if (interested === false) {
                                // No good, a negative matched, abort!
                            }

                            else if (positive_rex === true) {
                                // We're watching for all stories
                                interested = ' matched';
                            }

                            else if (positive_rex.test(title)) {
                                var m = title.match(positive_rex),
                                    word = m[1];

                                interested = ' with ‘' + word + '’ in the title';
                            }

                            else if (positive_rex.test(at_author)) {
                                var m = at_author.match(positive_rex),
                                    word = m[1];

                                interested = ' with ‘' + word + '’ as the author';
                            }

                            else if (positive_rex.test(body)) {
                                var m = body.match(positive_rex),
                                    word = m[1],
                                    pos = m.index,
                                    start = Math.max(0, pos-20),
                                    end;

                                if (start < 5) {
                                    start = 0;
                                }

                                end = pos + 30;
                                if (end > body.length - 5) {
                                    end = body.length;
                                }

                                var found = body.substring(start, end);

                                if (start > 0) {
                                    found = '…' + found.replace(/^\S+\s+[-,.;:]*/, '');
                                }
                                if (end < body.length) {
                                    found = found.replace(/[-,.;:]*\s+\S+$/, '') + '…';
                                }

                                interested = ' with ‘' + m[0] + '’ keyword in body: “' + found + '”';
                            }

                            else for (var k = 0; k < tags.length; k++) {
                                var tag = '#' + tags[k];
                                if (positive_rex.test(tag)) {
                                    interested = ' with the ‘' + tag + '’ tag';
                                    break;
                                }
                            }

                            // If we're still interested (no negatives and at least one positive match.
                            if (interested || interested === '') {
                                var link = parent_permlink+'/@'+author+'/'+permlink;
                                if (!state.listed[cid+':'+author+':'+permlink]) {
                                    console.log('https://steemit.com/' + link, 'found', interested);

                                    var post_moment = moment(seen),
                                        post_date = post_moment.format("YYYY-MM-DD"),
                                        post_time = post_moment.format("hh:mm"),
                                        post_ago = post_moment.fromNow();

                                    bot.sendMessage({
                                        to: cid,
                                        message: 'Found a story at https://steemit.com/' + link + ' on ' + post_date + ' at ' + post_time + ' UTC (' + post_ago + ')' + interested + '.'
                                    });

                                    state.listed['P:'+author+':'+permlink] = now + ':' + parent_permlink;
                                    state.listed[cid+':'+author+':'+permlink] = now;
                                    save();
                                }
                            }
                        }
                    }

                    state.listed['S:'+author+':'+permlink] = now + ':' + seen;
                }
            }
        }
    }
}

var fetch_block = function(block_id) {
    console.log('Getting block', block_id, '...');
    callrpc('get_block', [block_id], function(err, block) {
        process_block(block, block_id);
    });
}

var bot_ready = false,
    steem_ready = false;

var start_loop = function() {
    if (!bot_ready || !steem_ready) {
        return;
    }

    if (!channels) {
        load_channels();
    }

    var now = +(new Date);
    if (last_ping > 0 && now - last_ping > 60000) {
        console.log("Nothing received from Discord in over 60 seconds, restarting!");
        process.exit(2);
    }

    var delay = block_interval * 1000;

    callrpc('get_dynamic_global_properties', [], function(err, props) {
        if (err) {
            console.log('Error getting last block number:', err);
        } else {
            var block_number = props['last_irreversible_block_num'];
			if (state.last_block === -1) {
				state.last_block = block_number;
			}

            if ((block_number - state.last_block) > 0) {
                state.last_block += 1;
                fetch_block(state.last_block);
                save();
            }

            if ((block_number - state.last_block) > 0) {
                delay = 50;
            }
        }
        setTimeout(start_loop, delay);
    });
}

function make_rex(words) {
    if (!words || !words.length) {
        return null;
    }

    var rex_list = [];
    for (var i = 0; i < words.length; i++) {
        rex_list.push(
            words[i]
                .replace('\\', '\\\\')
                .replace('.', '\\.')
                .replace('+', '\\+')
                .replace('^', '\\^')
                .replace('|', '\\|')
                .replace('(', '\\(')
                .replace(')', '\\)')
                .replace('[', '\\[')
                .replace(']', '\\]')
                .replace('{', '\\{')
                .replace('}', '\\}')
                .replace('*', '.*')
                .replace('?', '.')
        );
    }

    var rex_text = '(?:\\b|\\s|^)(' + rex_list.join('|') + ')\\b';
    return new RegExp(rex_text, 'i');
}

function human_list(words, conjunction) {
    if (words.length < 1) {
        return 'nothing';
    } else if (words.length === 1) {
        return '‘' + words[0] + '’';
    } else if (words.length === 2) {
        return '‘' + words[0] + '’ ' + conjunction + ' ‘' + words[1] + '’';
    } else {
        return '‘' + words.slice(0, -1).join('’, ‘') + '’ ' + conjunction + ' ‘' + words[words.length - 1] + '’';
    }
}

function load_channels() {
    if (!bot_ready || !steem_ready) {
        return;
    }

    var channel_watch = {};
    for (var id in bot.channels) {
        var chan = bot.channels[id];

        if (state.debug) {
            console.log('Channel', chan);
        }

        if (!chan.topic) continue;

        var m = chan.topic.match(/steem-seeress=([^;\n]+)/);
        if (m && m[1]) {
            var matches = m[1].split(/\s*:\s*/);
            var words_list = [];
            var match_list = [];

            for (var i = 0; i < matches.length; i++) {
                var words = matches[i].split(/\s*,\s*/);

                var positive_words = [],
                    negative_words = [],
                    voter_words = [],
                    match_all = false,
                    match_none = false;

                for (var j = 0; j < words.length; j++) {
                    var word = words[j],
                        c = word.charAt(0);

                    if (word === '*') {
                        match_all = true;
                    } else if (word === '!*' || word === '-*') {
                        match_none = true;
                    } else if (c === '-' || c === '!') {
                       negative_words.push(word.substr(1));
                    } else if (c === '$') {
                       voter_words.push(word.substr(1));
                    } else {
                       positive_words.push(word);
                    }
                }

                positive_words.sort();
                negative_words.sort();

                var positive_rex = make_rex(positive_words),
                    negative_rex = make_rex(negative_words),
                    voter_rex = make_rex(voter_words);

                if (match_all) {
                    positive_rex = true;
                }

                if (!match_none && (match_all || positive_words.length)) {
                    var words_text;

                    if (match_all) {
                        words_text = 'all stories';
                    } else {
                        words_text = 'the keywords ' + human_list(positive_words, 'or');
                    }

                    if (negative_words.length) {
                        words_text += ', excluding ' + human_list(negative_words, 'and');
                    }

                    if (voter_words.length) {
                        words_text += ', plus votes on them by ' + human_list(voter_words, 'or');
                    }

                    words_list.push(words_text);

                    match_list.push({
                        positive: positive_rex,
                        negative: negative_rex,
                        voter: voter_rex
                    });
                }
            }

            var words_text = false;
            if (words_list.length > 0) {
                var words_text = words_list.join(" ＋ ");

                if (state.watching[id] !== words_text) {
                    bot.sendMessage({
                        to: id,
                        message: 'I’m now watching for ' + words_text + '.'
                    });
                    state.watching[id] = words_text;
                    save();
                }

                if (state.debug) {
                    console.log('Watching', id, chan.name, 'for', words_text);
                    console.log('Watch matches', match_list);
                }

                channel_watch[id] = {
                    id: id,
                    name: chan.name,
                    matches: match_list,
                    words: words_text
                };
            }
        }

        if (!channel_watch[id] && state.watching[id]) {
            bot.sendMessage({
                to: id,
                message: 'I’m no longer watching for any keywords.'
            });
            delete state.watching[id];
            save();
        }
    }

    channels = channel_watch;
}

load();

if (state.discord_token === DEFAULT_TOKEN) {
	save();
	console.log('Edit config.json to set your discord token');
	process.exit(1);
}

console.log('Connecting...');

var bot = new Discord.Client({
        token: state.discord_token,
        autorun: true
});

bot.on('ready', function() {
    console.log('Bot', bot.username, '(' + bot.id + ') is ready');

    load_channels();

    bot_ready = true;
    start_loop();
});

bot.on('channelDelete', function() {
    load_channels();
});

bot.on('channelUpdate', function() {
    load_channels();
});

bot.on('guildCreate', function() {
    load_channels();
});

bot.on('guildUpdate', function() {
    load_channels();
});

bot.on('guildDelete', function() {
    load_channels();
});

var last_ping = -1;
bot.on('any', function() {
    if (state.debug) {
        console.log('Bot got', arguments);
    }
    last_ping = +(new Date);
});

var client = new rpc.Client(state.steemd_options);

var block_interval;

console.log('Getting config...');
callrpc('get_config', [],
    function (err, config) {
        if (err) { console.log(err); }
        else {
            block_interval = config['STEEMIT_BLOCK_INTERVAL']
            steem_ready = true;
            start_loop();
        }
    }
)

/* vim: set ai ts=4 sts=4 sw=4 tw=0 et : */
