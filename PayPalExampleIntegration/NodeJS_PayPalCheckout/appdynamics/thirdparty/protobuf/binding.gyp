{
	"targets": [
		{
			"target_name": "protobuf_for_node",
			"sources": [
				"protobuf_for_node.cc", "addon.cc"
			],
			'conditions': [
				[
					'OS =="linux" and target_arch != "ia32"', {
						"include_dirs": ["../../../protobuf/x64-linux/include"],
						"libraries" : ["../../../../protobuf/x64-linux/lib/libprotobuf.a"]
					}
				],
				[
					'OS =="linux" and target_arch == "ia32"', {
						"include_dirs": ["../../../protobuf/x86-linux/include"],
						"libraries" : ["../../../../protobuf/x86-linux/lib/libprotobuf.a"]
					}
				],
				[
					'OS =="mac"', {
						"include_dirs" : ["../../../protobuf/x64-osx/include"],
						"libraries" : ["../../../../protobuf/x64-osx/lib/libprotobuf.a"],
						'xcode_settings':{
						  'OTHER_CFLAGS' : [
							'-mmacosx-version-min=10.7'
						  ]
						},
			  		}
				]
			]
		}
	]
}
