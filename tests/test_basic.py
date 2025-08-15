def test_import_and_version():
	import youtube_colab_proxy as ycp
	assert hasattr(ycp, "__version__")
	assert isinstance(ycp.__version__, str) 
